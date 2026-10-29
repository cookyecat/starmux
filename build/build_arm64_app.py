#!/usr/bin/env python3
"""Build a self-contained Apple Silicon Starmux App from the npm runtime package."""
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
APP = "Starmux.app"
ID = "dev.starmux.ownerapp"
NODE_VERSION = "v26.10.0"
# Official v26.10.0 SHASUMS256.txt: accept the documented gzip and xz archives.
NODE_ARCHIVE_SHAS = {
    "751fdf7439f115d87ee2a8f3f18c065b6151852068e3e666ac60ac2996f75ac9",
    "f222f7e85cc1d5a3d84786aa86836ec3d41c4dcdf59a40e4a9d719b6b0ae28af",
}
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

def source_metadata():
    metadata=ROOT/".git"
    if not metadata.exists() and not metadata.is_symlink():
        return {"commit":None,"sourceDirty":None,"sourceOrigin":"source-archive"}
    # A checkout with broken/missing Git must fail, not claim archive provenance.
    return {"commit":run("git","rev-parse","HEAD",cwd=ROOT).stdout.strip(),
            "sourceDirty":bool(run("git","status","--porcelain",cwd=ROOT).stdout.strip()),
            "sourceOrigin":"git-checkout"}

def signed(app):
    run("/usr/bin/codesign","--verify","--deep","--strict",str(app),timeout=120)

def build(out,archive,offline=False):
    require(sys.platform=="darwin","MACOS_ONLY")
    machine=run("/usr/bin/uname","-m").stdout.strip()
    require(machine=="arm64","ARM64_ONLY")
    require(not out.exists() or (out.is_dir() and not any(out.iterdir())),
            "NONEMPTY_OUTPUT_REFUSED")
    require(archive.is_file() and not archive.is_symlink() and
            sha(archive) in NODE_ARCHIVE_SHAS,"OFFICIAL_ARM64_NODE_HASH_MISMATCH")
    require((ROOT/"package-lock.json").is_file(),"SOURCE_LOCKFILE_REQUIRED")
    package=json.loads((ROOT/"package.json").read_text())
    lock=json.loads((ROOT/"package-lock.json").read_text())
    version=package.get("version")
    require(version==lock.get("version")==lock.get("packages",{}).get("",{}).get("version"),
            "SOURCE_VERSION_LOCK_MISMATCH")
    require(version and package.get("license")=="MIT" and
            (ROOT/"LICENSE").is_file() and
            "MIT License" in (ROOT/"LICENSE").read_text(),
            "GATEWAY_MIT_LICENSE_REQUIRED")
    require(package.get("devDependencies",{}).get("@wonderwhy-er/desktop-commander")==lock.get("packages",{}).get("node_modules/@wonderwhy-er/desktop-commander",{}).get("version"),
            "UNVERIFIED_DC_UPSTREAM_VERSION")
    require(out.resolve()!=ROOT.resolve() and not out.is_symlink(),
            "UNTRUSTED_BUILD_OUTPUT")
    # Compile the native UI.
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
    info["CFBundleVersion"]=version
    info_path.write_bytes(plistlib.dumps(info))
    resources=contents/"Resources"
    runtime=resources/"runtime"
    core=runtime/"core"
    cli=runtime/"cli"
    node=runtime/"bin"/"node"
    core.mkdir(parents=True)
    cli.mkdir()
    node.parent.mkdir()
    # npm's release lifecycle builds the runtime artifact.
    # Extract only regular runtime files; install production deps from the source lock.
    npm=shutil.which("npm")
    require(npm is not None,"NPM_BUILD_TOOL_MISSING")
    with tempfile.TemporaryDirectory(prefix="starmux-app-pack-") as temporary:
        packed_output=run(npm,"pack","--json","--pack-destination",temporary,cwd=ROOT,timeout=300).stdout
        manifest=json.loads(packed_output[packed_output.rfind("\n[\n")+1:])
        packed=Path(temporary)/manifest[0]["filename"]
        runtime_package_sha=sha(packed)
        with tarfile.open(packed,"r:gz") as tar:
            for member in tar.getmembers():
                relative=Path(member.name)
                require(relative.parts[0]=="package" and ".." not in relative.parts,"UNSAFE_PACKAGE_PATH")
                if member.isdir():continue
                require(member.isfile(),"PACKAGE_LINK_REFUSED")
                destination=core/Path(*relative.parts[1:])
                destination.parent.mkdir(parents=True,exist_ok=True)
                with tar.extractfile(member) as source,destination.open("wb") as dest:
                    shutil.copyfileobj(source,dest)
                destination.chmod(member.mode & 0o755)
    shutil.copy2(ROOT/"package-lock.json",core/"package-lock.json")
    with tarfile.open(archive,"r:*") as tar:
        member=tar.getmember(NODE_MEMBER)
        require(member.isfile() and member.size<180000000,"NODE_ARCHIVE_MEMBER_UNSAFE")
        with tar.extractfile(member) as source,node.open("xb") as dest:
            shutil.copyfileobj(source,dest)
    node.chmod(0o755)
    require(run(str(node),"--version").stdout.strip()==NODE_VERSION,"NODE_WRONG_VERSION")
    # npm ci materializes precisely the checked-in lockfile in this fresh core.
    npm=shutil.which("npm")
    require(npm is not None,"NPM_BUILD_TOOL_MISSING")
    flags=["ci","--omit=dev","--no-audit","--no-fund"]
    if offline:flags.append("--offline")
    run(npm,*flags,cwd=core,timeout=240)
    require(sha(core/"package-lock.json")==sha(ROOT/"package-lock.json"),
            "BUNDLED_LOCK_DRIFT")
    package_dir=core/"dist/vendor/desktop-commander"
    dc_pkg=json.loads((package_dir/"package.json").read_text())
    require(dc_pkg.get("version")==package["devDependencies"]["@wonderwhy-er/desktop-commander"] and dc_pkg.get("license")=="MIT" and
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
    launcher=cli/"starmux"
    launcher.write_text('''#!/bin/sh
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
root=$(CDPATH= cd -- "$here/.." && pwd -P)
exec "$root/bin/node" "$root/core/bin/starmux.mjs" "$@"
''')
    launcher.chmod(0o755)
    third=resources/"THIRD_PARTY_NOTICES"
    third.mkdir()
    shutil.copy2(package_dir/"LICENSE",third/"DesktopCommander-MIT.txt")
    # Inventory lock-installed transitive package licenses.
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
        "Starmux includes Desktop Commander as a separate upstream "
        "implementation, under the MIT license. The unchanged copyright and "
        "permission notice is in DesktopCommander-MIT.txt. Other bundled "
        "dependencies are listed in dependency-license-inventory.json. "
        "Original Starmux code is MIT licensed: see the bundled "
        "root LICENSE. \n")
    # Sign every bundled Mach-O item before sealing the outer App.
    native=[node]+[x for x in (core/"node_modules").rglob("*") if x.is_file()
                   and x.suffix in (".node",".dylib") and not x.is_symlink()]
    for i,component in enumerate(native):
        run("/usr/bin/codesign","--force","--sign","-","--timestamp=none",
            "--identifier",ID+".bundled."+str(i),str(component))
    # Renew the outer seal after embedding the runtime.
    source=source_metadata()
    commit=source["commit"]
    manifest={
      "schema":1,"product":"Starmux","version":version,"build":version,
      "architecture":"arm64","bundleIdentifier":ID,
      **source,"npmPackageSHA256":runtime_package_sha,
      "sourcePackageLockSHA256":sha(ROOT/"package-lock.json"),
      "bundledPackageLockSHA256":sha(core/"package-lock.json"),
      "bundledNodeSHA256":sha(node),"nodeVersion":NODE_VERSION,
      "gatewayLicense":"MIT","gatewayLicenseSHA256":sha(core/"LICENSE"),
      "desktopCommanderVersion":dc_pkg["version"],"desktopCommanderLicense":"MIT",
      "desktopCommanderLicenseSHA256":sha(third/"DesktopCommander-MIT.txt"),
      "entrypoints":["CLI","App"],"nativeSignedCount":len(native),
      "includedRuntimeSourceFiles":len(list((core/"dist/src").rglob("*.js"))),
      "sourceLanguage":"TypeScript","compilerVersion":package["devDependencies"]["typescript"],
      "gatewayCoreServiceRegistered":False,"loginAutostart":False,
      "dependenciesReinstalledFromLockfile":True,"sourceType":"npm-runtime-package",
      "codeSignatureKind":"adhoc"
    }
    (resources/"build-manifest.json").write_text(json.dumps(manifest,indent=2,sort_keys=True)+"\n")
    run("/usr/bin/codesign","--force","--sign","-","--timestamp=none",
        "--identifier",ID,str(app),timeout=120)
    signed(app)
    print(json.dumps({"result":"STARMUX_APP_BUILT",
        "app":str(app),"gitCommit":commit,"version":version,
        "bundle":"signed-adhoc","dependencyCount":len(items),
        "nodeSha256":manifest["bundledNodeSHA256"],
        "dcLicenseSha256":manifest["desktopCommanderLicenseSHA256"]},sort_keys=True))

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--output",type=Path,required=True)
    p.add_argument("--node-archive",type=Path,required=True)
    p.add_argument("--offline",action="store_true")
    a=p.parse_args()
    try:build(a.output.expanduser(),a.node_archive.expanduser(),a.offline)
    except Exception as e:
        print(json.dumps({"result":"STARMUX_APP_BUILD_FAILED",
                          "reason":str(e)[:250]}))
        sys.exit(2)

if __name__=="__main__":main()
