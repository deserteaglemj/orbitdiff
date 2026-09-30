# Native builds run through scripts/build_desktop.py with an explicit input list.
import json
import os
from pathlib import Path

config = json.loads(Path(os.environ["ORBIT_DESKTOP_BUILD_CONFIG"]).read_text())

a = Analysis(
    [config["entry"]],
    pathex=[config["source"]],
    binaries=[],
    datas=[tuple(item) for item in config["assets"]],
    hiddenimports=["webview", "webview.platforms.cocoa", "instaloader.__main__"],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "tkinter", "pytest", "setuptools", "PyQt5", "PyQt6", "PySide2", "PySide6",
        "webview.platforms.gtk", "webview.platforms.qt", "webview.platforms.edgechromium",
        "webview.platforms.mshtml", "webview.platforms.winforms", "webview.platforms.android",
    ],
    noarchive=False,
    optimize=1,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="orbit-os",
    debug=False,
    bootloader_ignore_signals=False,
    strip=True,
    upx=False,
    console=True,
    target_arch="arm64",
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(exe, a.binaries, a.datas, strip=True, upx=False, name="Orbit OS")
app = BUNDLE(
    coll,
    name="Orbit OS.app",
    icon=config["icon"],
    bundle_identifier="com.orbitdiff.orbitos",
    version=config["version"],
    info_plist={
        "CFBundleDisplayName": "Orbit OS",
        "CFBundleShortVersionString": config["version"],
        "NSHighResolutionCapable": True,
        "LSMinimumSystemVersion": "13.0",
        "NSAppTransportSecurity": {"NSAllowsLocalNetworking": True},
    },
)
