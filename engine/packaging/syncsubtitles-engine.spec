# PyInstaller spec for the engine sidecar (`syncsubtitles serve`), frozen so
# the installed app never needs Python or uv. Run from engine/ (or through
# packaging/build_sidecar.py, which `tauri build` calls):
#
#   uv run pyinstaller packaging/syncsubtitles-engine.spec --noconfirm
#
# A folder ("onedir": the exe and its libraries, nothing unpacked at
# launch, so it starts in about a second), shipped as the app's engine/
# resource. ffmpeg comes with imageio-ffmpeg (its PyInstaller hook bundles
# the binary).
#
# console=False: launched silently by the app; a console window popping up
# next to it would look broken.
a = Analysis(
    ["../src/syncsubtitles/cli.py"],
    pathex=["../src"],
    binaries=[],
    datas=[],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter"],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="syncsubtitles-engine",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="syncsubtitles-engine",
)
