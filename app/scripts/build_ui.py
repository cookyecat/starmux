#!/usr/bin/env python3
"""Signed, one-entry macOS menu bar application (build only).

Builds the menu UI in an isolated output directory.
"""
import argparse
import json
import struct
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[1]
BASE=ROOT
SRC=ROOT/"src"
IDENTITY="dev.starmux.ownerapp"
NAME="Starmux.app"

def run(*cmd, timeout=180):
    try:
        return subprocess.run(cmd,check=True,capture_output=True,text=True,timeout=timeout)
    except subprocess.CalledProcessError as error:
        print(error.stderr,file=sys.stderr)
        raise

def build(target:Path):
    if sys.platform!="darwin":
        raise RuntimeError("MACOS_BUILD_REQUIRED")
    if target.exists() and any(target.iterdir()):
        raise RuntimeError("NONEMPTY_OUTPUT_REFUSED")
    target.mkdir(parents=True,exist_ok=True)
    app=target/NAME
    contents=app/"Contents"
    binary=contents/"MacOS"
    resources=contents/"Resources"
    binary.mkdir(parents=True)
    resources.mkdir(parents=True)
    version=json.loads((ROOT.parent/"package.json").read_text())["version"]
    with (contents/"Info.plist").open("wb") as f:
        plistlib.dump({
          "CFBundleIdentifier":IDENTITY,
          "CFBundleName":"Starmux",
          "CFBundleDisplayName":"Starmux",
          "CFBundleExecutable":"StarmuxMenu",
          "CFBundleVersion":version,
          "CFBundleShortVersionString":version,
          "CFBundlePackageType":"APPL",
          "LSUIElement":True,
          "LSMinimumSystemVersion":"13.0",
          "NSHighResolutionCapable":True,
          "CFBundleIconFile":"AppIcon.icns",
        },f)
    run("/usr/bin/xcrun","swift",
        str(ROOT/"scripts/RenderBrandIcon.swift"),str(resources))
    iconset=target/"icon.iconset"
    iconset.mkdir()
    sizes=((16,"icon_16x16.png"),(32,"icon_16x16@2x.png"),
           (32,"icon_32x32.png"),(64,"icon_32x32@2x.png"),
           (128,"icon_128x128.png"),(256,"icon_128x128@2x.png"),
           (256,"icon_256x256.png"),(512,"icon_256x256@2x.png"),
           (512,"icon_512x512.png"),(1024,"icon_512x512@2x.png"))
    for size,file in sizes:
        run("/usr/bin/sips","-z",str(size),str(size),str(resources/"AppLogo.png"),
            "--out",str(iconset/file))
    chunks=[]
    for kind,file in ((b"icp4","icon_16x16.png"),(b"icp5","icon_32x32.png"),
                      (b"icp6","icon_32x32@2x.png"),(b"ic07","icon_128x128.png"),
                      (b"ic08","icon_256x256.png"),(b"ic09","icon_512x512.png"),
                      (b"ic10","icon_512x512@2x.png")):
        png=(iconset/file).read_bytes()
        chunks.append(kind+struct.pack(">I",len(png)+8)+png)
    payload=b"".join(chunks)
    (resources/"AppIcon.icns").write_bytes(b"icns"+struct.pack(">I",len(payload)+8)+payload)
    shutil.rmtree(iconset)
    run("/usr/bin/xcrun","swiftc","-O",
        "-framework","SwiftUI","-framework","AppKit",
        str(SRC/"ConnectionDiagnostics.swift"),
        str(SRC/"ConnectionFlowDiagram.swift"),
        str(SRC/"RecentActivityDisclosure.swift"),
        str(SRC/"AppLanguage.swift"),
        str(SRC/"InstanceController.swift"),
        str(SRC/"AppForegroundExitDelegate.swift"),
        str(SRC/"InstanceManager.swift"),
        str(SRC/"UnifiedMenu.swift"),"-o",str(binary/"StarmuxMenu"))
    run("/usr/bin/codesign","--force","--sign","-","--timestamp=none",
        "--identifier",IDENTITY,str(app))
    run("/usr/bin/codesign","--verify","--deep","--strict",str(app))
    print("STARMUX_APP_BUILT",app,flush=True)
    return app

if __name__=="__main__":
    cli=argparse.ArgumentParser()
    cli.add_argument("--output-dir",type=Path,required=True)
    args=cli.parse_args()
    try:build(args.output_dir.expanduser().resolve())
    except (RuntimeError,subprocess.CalledProcessError) as error:
        print("STARMUX_APP_BUILD_ERROR",str(error)[:650],file=sys.stderr)
        raise SystemExit(2)
