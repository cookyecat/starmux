#!/usr/bin/env python3
"""Build-only, source-locked arm64 Community Preview candidate.

Does not read ~/Library private Gateway releases/node_modules, install an App,
bind a port, register a Service, grant FDA, or create a public repository.
Ad-hoc code signatures: OWNER/PREVIEW only, not Developer ID notarization.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[1]
APP = "Mac MCP Gateway.app"
ID = "dev.macmcpgateway.ownerapp"
NODE_VERSION = "v26.10.0"
NODE_ARCHIVE_SHA = "f222f7e85cc1d5a3d84786aa86836ec3d41c4dcdf59a40e4a9d719b6b0ae28af"
NODE_MEMBER = "node-v26.10.0-darwin-arm64/bin/node"

def sha(path):
    h=hashlib.sha256()
    with open(path,"rb") as f:
        for chunk in iter(lambda:f.read(1024*1024),b""):
            h.update(chunk)
    return h.hexdigest()

def run(*args,timeout=240,cwd=None):
    return subprocess.run(args,capture_output=True,text=True,check=True,timeout=timeout,cwd=cwd)

def require(condition,code):
    if not condition:raise RuntimeError(code)

def source_commit():
    # Fresh community ZIP deliberately carries no private Git history.
    return "community-source-v0.9.0"

def signed(app):
    run("/usr/bin/codesign","--verify","--deep","--strict",str(app),timeout=120)

def build(out,archive,offline=False):
    require(sys.platform=="darwin","MACOS_ONLY")
    machine=run("/usr/bin/uname","-m").stdout.strip()
    require(machine=="arm64","ARM64_ONLY")
    require(not out.exists() or (out.is_dir() and not any(out.iterdir())),
            "NONEMPTY_OUTPUT_REFUSED")
    require(archive.is_file() and not archive.is_symlink() and
            sha(archive)==NODE_ARCHIVE_SHA,"OFFICIAL_ARM64_NODE_HASH_MISMATCH")
    require((ROOT/"package-lock.json").is_file(),"SOURCE_LOCKFILE_REQUIRED")
    # The public source snapshot uses explicit source filenames and forbids
    # private .git/history in the build input instead of requiring private git.
    package=json.loads((ROOT/"package.json").read_text())
    lock=json.loads((ROOT/"package-lock.json").read_text())
    version=package.get("version")
    require(version==lock.get("version")==lock.get("packages",{}).get("",{}).get("version"),
            "SOURCE_VERSION_LOCK_MISMATCH")
    require(version and package.get("license")=="MIT" and
            (ROOT/"LICENSE").is_file() and
            "MIT License" in (ROOT/"LICENSE").read_text(),
            "GATEWAY_MIT_LICENSE_REQUIRED")
    require(package.get("dependencies",{}).get("@wonderwhy-er/desktop-commander")=="0.3.0",
            "UNVERIFIED_DC_UPSTREAM_VERSION")
    require(out.resolve()!=ROOT.resolve() and not out.is_symlink(),
            "UNTRUSTED_BUILD_OUTPUT")
    # Build UI from tracked source, not from the deployed private installation.
    out.mkdir(parents=True,exist_ok=True)
    spec=importlib.util.spec_from_file_location("clean_ui",ROOT/"app/scripts/build_ui.py")
    ui=importlib.util.module_from_spec(spec);spec.loader.exec_module(ui)
    ui.build(out)
    app=out/APP
    contents=app/"Contents"
    info_path=contents/"Info.plist"
    info=plistlib.loads(info_path.read_bytes())
    require(info.get("CFBundleIdentifier")==ID,"BUNDLE_IDENTITY_DRIFT")
    info["CFBundleShortVersionString"]=version
    info["CFBundleVersion"]="15"
    info_path.write_bytes(plistlib.dumps(info))
    resources=contents/"Resources"
    runtime=resources/"runtime"
    core=runtime/"core"
    cli=runtime/"cli"
    node=runtime/"bin"/"node"
    core.mkdir(parents=True)
    cli.mkdir()
    node.parent.mkdir()
    # Compile in an independent staging checkout with locked build dependencies.
    # The shipped runtime contains only emitted JS, stable launchers and production deps.
    npm=shutil.which("npm")
    require(npm is not None,"NPM_BUILD_TOOL_MISSING")
    tracked=sorted(p.relative_to(ROOT) for base in ("src","bin","scripts","test")
                   for p in (ROOT/base).rglob("*")
                   if p.is_file() and p.suffix in (".ts",".mjs",".txt"))
    require(len([p for p in tracked if p.suffix==".ts"])>=41,
            "PUBLIC_SOURCE_ALLOWLIST_TOO_SMALL")
    with tempfile.TemporaryDirectory(prefix="gateway-ts-build-") as temporary:
        staging=Path(temporary)
        for relative in [*tracked,Path("package.json"),Path("package-lock.json"),Path("tsconfig.json")]:
            source=ROOT/relative
            require(source.is_file() and not source.is_symlink(),"SOURCE_SYMLINK_OR_MISSING_REFUSED")
            dest=staging/relative
            dest.parent.mkdir(parents=True,exist_ok=True)
            shutil.copy2(source,dest)
        flags=["ci","--include=dev","--ignore-scripts","--no-audit","--no-fund"]
        if offline:flags.append("--offline")
        run(npm,*flags,cwd=staging,timeout=300)
        run(npm,"run","build",cwd=staging,timeout=120)
        shutil.copytree(staging/"dist/src",core/"dist/src")
    for relative in [p for p in tracked if p.suffix==".mjs" or str(p)=="test/fixtures/p1-fixture.txt"]:
        dest=core/relative
        dest.parent.mkdir(parents=True,exist_ok=True)
        shutil.copy2(ROOT/relative,dest)
    for filename in ("LICENSE","README.md","package.json","package-lock.json"):
        shutil.copy2(ROOT/filename,core/filename)
    with tarfile.open(archive,"r:xz") as tar:
        member=tar.getmember(NODE_MEMBER)
        require(member.isfile() and member.size<180000000,"NODE_ARCHIVE_MEMBER_UNSAFE")
        with tar.extractfile(member) as source,node.open("xb") as dest:
            shutil.copyfileobj(source,dest)
    node.chmod(0o755)
    require(run(str(node),"--version").stdout.strip()==NODE_VERSION,"NODE_WRONG_VERSION")
    # npm ci materializes precisely the checked-in lockfile in this fresh core.
    npm=shutil.which("npm")
    require(npm is not None,"NPM_BUILD_TOOL_MISSING")
    flags=["ci","--omit=dev","--ignore-scripts","--no-audit","--no-fund"]
    if offline:flags.append("--offline")
    run(npm,*flags,cwd=core,timeout=240)
    require(sha(core/"package-lock.json")==sha(ROOT/"package-lock.json"),
            "BUNDLED_LOCK_DRIFT")
    package_dir=core/"node_modules/@wonderwhy-er/desktop-commander"
    dc_pkg=json.loads((package_dir/"package.json").read_text())
    require(dc_pkg.get("version")=="0.3.0" and dc_pkg.get("license")=="MIT" and
            (package_dir/"LICENSE").is_file(),"DESKTOP_COMMANDER_MIT_MISSING")
    require((package_dir/"dist/index.js").is_file(),"NATIVE_DC_ENTRY_MISSING")
    # Require all symlinks in the runtime to remain within the App bundle.
    for path in runtime.rglob("*"):
        if path.is_symlink():
            require(path.resolve(strict=True).is_relative_to(runtime.resolve()),
                    "RUNTIME_SYMLINK_ESCAPES_BUNDLE")
    # Executable script is located inside the app; no global npm/Homebrew
    # installation is required by this App. The actual installed CLI can
    # be a user-local wrapper which forwards to this same bundle.
    launcher=cli/"mac-mcp-gateway"
    launcher.write_text('''#!/bin/sh
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
root=$(CDPATH= cd -- "$here/.." && pwd -P)
exec "$root/bin/node" "$root/core/bin/mac-mcp-gateway.mjs" "$@"
''')
    launcher.chmod(0o755)
    third=resources/"THIRD_PARTY_NOTICES"
    third.mkdir()
    shutil.copy2(package_dir/"LICENSE",third/"DesktopCommander-MIT.txt")
    # Inventory lock-installed transitive package licenses; this inventory
    # is not a substitute for manual per-asset legal review.
    items=[]
    for item in sorted((core/"node_modules").rglob("package.json")):
        if "node_modules" not in item.parts:continue
        if item.is_symlink():continue
        try:d=json.loads(item.read_text())
        except (ValueError,UnicodeDecodeError):continue
        if d.get("name"):
            items.append({"name":d["name"],"version":d.get("version"),
                          "license":d.get("license","UNDECLARED")})
    (third/"dependency-license-inventory.json").write_text(
        json.dumps(items,indent=2,sort_keys=True)+"\n")
    (third/"NOTICE.txt").write_text(
        "Mac MCP Gateway includes Desktop Commander as a separate upstream "
        "implementation, under the MIT license. The unchanged copyright and "
        "permission notice is in DesktopCommander-MIT.txt. Other bundled "
        "dependencies are listed in dependency-license-inventory.json. "
        "Original Mac MCP Gateway code is MIT licensed: see the bundled "
        "root LICENSE. Third-party notices and independent publication gates "
        "must still be checked before public distribution.\n")
    # Sign every bundled Mach-O item before sealing the outer App.
    native=[node]+[x for x in (core/"node_modules").rglob("*") if x.is_file()
                   and x.suffix in (".node",".dylib") and not x.is_symlink()]
    for i,component in enumerate(native):
        run("/usr/bin/codesign","--force","--sign","-","--timestamp=none",
            "--identifier",ID+".bundled."+str(i),str(component))
    # The prototype UI embeds its own signed UnifiedSnapshotCLI, already
    # signed by canonical UI builder; only outer seal needs renewal.
    commit=source_commit()
    manifest={
      "schema":1,"product":"Mac MCP Gateway","version":version,"build":"15",
      "architecture":"arm64","bundleIdentifier":ID,
      "commit":commit,"sourcePackageLockSHA256":sha(ROOT/"package-lock.json"),
      "bundledPackageLockSHA256":sha(core/"package-lock.json"),
      "bundledNodeSHA256":sha(node),"nodeVersion":NODE_VERSION,
      "gatewayLicense":"MIT","gatewayLicenseSHA256":sha(core/"LICENSE"),
      "desktopCommanderVersion":"0.3.0","desktopCommanderLicense":"MIT",
      "desktopCommanderLicenseSHA256":sha(third/"DesktopCommander-MIT.txt"),
      "entrypoints":["CLI","App"],"nativeSignedCount":len(native),
      "includedRuntimeSourceFiles":len(list((core/"dist/src").rglob("*.js"))),
      "sourceLanguage":"TypeScript","compilerVersion":package["devDependencies"]["typescript"],"privateSourceCopied":False,
      "gatewayCoreServiceRegistered":False,"loginAutostart":False,
      "remoteHttpsAuthenticated":False,"remoteTunnelExternalAccepted":False,
      "dependenciesReinstalledFromLockfile":True,"sourceType":"fresh_privacy_audited_public_snapshot",
      "distributionApproved":False,"codeSignatureKind":"adhoc"
    }
    (resources/"community-build-manifest.json").write_text(json.dumps(manifest,indent=2,sort_keys=True)+"\n")
    run("/usr/bin/codesign","--force","--sign","-","--timestamp=none",
        "--identifier",ID,str(app),timeout=120)
    signed(app)
    # CLI bundle smoke without any installed npm/Node.
    result=run(str(launcher),"--help",timeout=15)
    require(("Mac MCP Gateway "+version) in result.stdout,
            "BUNDLED_STANDALONE_CLI_FAIL")
    result=run(str(node),"--input-type=module","-e",
        "import('file://"+str(core/"dist/src/local-desktop-read-probe.js")+
        "').then(()=>console.log('DC_MODULE_IMPORTED'))",timeout=20,cwd=core)
    require("DC_MODULE_IMPORTED" in result.stdout,"BUNDLED_DC_IMPORT_FAIL")
    print(json.dumps({"result":"COMMUNITY_ARM64_BUILD_ONLY_PASS",
        "app":str(app),"gitCommit":commit,"version":version,
        "bundle":"signed-adhoc","dependencyCount":len(items),
        "nodeSha256":manifest["bundledNodeSHA256"],
        "dcLicenseSha256":manifest["desktopCommanderLicenseSHA256"],
        "noService":True,"noProductionMutation":True},sort_keys=True))

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--output",type=Path,required=True)
    p.add_argument("--node-archive",type=Path,required=True)
    p.add_argument("--offline",action="store_true")
    a=p.parse_args()
    try:build(a.output.expanduser(),a.node_archive.expanduser(),a.offline)
    except Exception as e:
        print(json.dumps({"result":"COMMUNITY_BUILD_REFUSED",
                          "reason":str(e)[:250]}))
        sys.exit(2)

if __name__=="__main__":main()
