#!/usr/bin/env python3
"""Signed, one-entry macOS menu bar product prototype (build only).

Merges observer + diagnostics without touching 8793, TCC, LaunchAgents,
installed B4/B5 research Apps or their code-signing identities.
"""
import argparse
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[1]
BASE=ROOT
SRC=ROOT/"src"
IDENTITY="dev.macmcpgateway.ownerapp"
NAME="Mac MCP Gateway.app"

def run(*cmd, timeout=180):
    return subprocess.run(cmd,check=True,capture_output=True,text=True,timeout=timeout)

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
    with (contents/"Info.plist").open("wb") as f:
        plistlib.dump({
          "CFBundleIdentifier":IDENTITY,
          "CFBundleName":"Mac MCP Gateway",
          "CFBundleDisplayName":"Mac MCP Gateway",
          "CFBundleExecutable":"MacMCPUnifiedMenu",
          "CFBundleVersion":"15",
          "CFBundleShortVersionString":"0.9.0",
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
    run("/usr/bin/iconutil","-c","icns","-o",str(resources/"AppIcon.icns"),str(iconset))
    shutil.rmtree(iconset)
    run("/usr/bin/xcrun","swiftc","-O",
        "-framework","SwiftUI","-framework","AppKit","-framework","ServiceManagement",
        str(SRC/"GatewayStatus.swift"),
        str(SRC/"NativeDiagnostics.swift"),
        str(SRC/"ConnectionDiagnostics.swift"),
        str(SRC/"ConnectionFlowDiagram.swift"),
        str(SRC/"RecentActivityDisclosure.swift"),
        str(SRC/"AppLanguage.swift"),
        str(SRC/"AppGatewayRunner.swift"),
        str(SRC/"FirstRunCoordinator.swift"),
        str(SRC/"CanonicalServiceControl.swift"),
        str(SRC/"UnifiedMenu.swift"),"-o",str(binary/"MacMCPUnifiedMenu"))
    run("/usr/bin/xcrun","swiftc","-O",
        str(SRC/"GatewayStatus.swift"),
        str(SRC/"NativeDiagnostics.swift"),
        str(SRC/"ConnectionDiagnostics.swift"),
        str(SRC/"AppGatewayRunner.swift"),
        str(SRC/"FirstRunCoordinator.swift"),
        str(SRC/"UnifiedSnapshotCLI.swift"),
        "-o",str(binary/"UnifiedSnapshotCLI"))
    run("/usr/bin/codesign","--force","--sign","-","--timestamp=none",
        "--identifier",IDENTITY+".cli",str(binary/"UnifiedSnapshotCLI"))
    run("/usr/bin/codesign","--force","--sign","-","--timestamp=none",
        "--identifier",IDENTITY,str(app))
    run("/usr/bin/codesign","--verify","--deep","--strict",str(app))
    print("COMMUNITY_MENU_APP_SOURCE_BUILT",app,flush=True)
    print("BUILD_ONLY_NO_PRODUCTION_MUTATION",flush=True)
    return app

if __name__=="__main__":
    cli=argparse.ArgumentParser()
    cli.add_argument("--output-dir",type=Path,required=True)
    args=cli.parse_args()
    try:build(args.output_dir.expanduser().resolve())
    except (RuntimeError,subprocess.CalledProcessError) as error:
        print("PHASE3_UNIFIED_BUILD_ERROR",str(error)[:650],file=sys.stderr)
        raise SystemExit(2)
