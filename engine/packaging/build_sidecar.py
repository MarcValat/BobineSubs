"""Build the FastAPI sidecar as a standalone folder and drop it where the Tauri
app bundles it from.

Usage (from engine/):  uv run python packaging/build_sidecar.py [--force]

Runs PyInstaller against syncsubtitles-engine.spec, which produces a folder
(PyInstaller's "onedir": the exe plus its libraries next to it, nothing
unpacked at launch), then copies that folder to
app/src-tauri/binaries/syncsubtitles-engine/. tauri.conf.json's
`bundle.resources` ships it as `engine/` next to the app's exe, where
src-tauri/src/lib.rs launches it from.

`tauri build` runs this itself (tauri.conf.json's `beforeBuildCommand`), so
an app build never ships a stale engine. PyInstaller only runs when
something that goes into the engine changed since the last build (see
`_source_hash`), which makes that step free the rest of the time; `--force`
rebuilds regardless.
"""

from __future__ import annotations

import hashlib
import shutil
import subprocess
import sys
from pathlib import Path

ENGINE_DIR = Path(__file__).resolve().parent.parent
BINARIES_DIR = ENGINE_DIR.parent / "app" / "src-tauri" / "binaries"
BUILT_DIR = BINARIES_DIR / "syncsubtitles-engine"
# Next to the bundled folder, not inside it: it isn't shipped.
HASH_FILE = BINARIES_DIR / "syncsubtitles-engine.source-hash"


def _source_hash() -> str:
    """A digest of everything the frozen engine is built from: its code, its
    locked dependencies (PyInstaller's own version included) and the spec."""
    files = sorted((ENGINE_DIR / "src").rglob("*.py")) + [
        ENGINE_DIR / "pyproject.toml",
        ENGINE_DIR / "uv.lock",
        ENGINE_DIR / "packaging" / "syncsubtitles-engine.spec",
    ]
    digest = hashlib.sha256(sys.version.encode())
    for path in files:
        digest.update(path.relative_to(ENGINE_DIR).as_posix().encode())
        # Line endings normalized: a checkout's CRLF/LF conversion changes nothing built.
        digest.update(path.read_bytes().replace(b"\r\n", b"\n"))
    return digest.hexdigest()


def main() -> None:
    source_hash = _source_hash()
    up_to_date = BUILT_DIR.is_dir() and HASH_FILE.is_file() and HASH_FILE.read_text().strip() == source_hash
    if up_to_date and "--force" not in sys.argv[1:]:
        print(f"[build_sidecar] {BUILT_DIR} is up to date, skipping PyInstaller (--force to rebuild)")
        return

    subprocess.run(
        ["uv", "run", "pyinstaller", "packaging/syncsubtitles-engine.spec", "--noconfirm"],
        cwd=ENGINE_DIR,
        check=True,
    )

    built = ENGINE_DIR / "dist" / "syncsubtitles-engine"
    if not built.is_dir():
        raise SystemExit(f"expected PyInstaller output at {built}, not found")

    # Replaced whole: a file dropped from the build must not linger in the bundle.
    if BINARIES_DIR.exists():
        shutil.rmtree(BINARIES_DIR)
    shutil.copytree(built, BUILT_DIR)
    HASH_FILE.write_text(source_hash + "\n")
    print(f"[build_sidecar] {built} -> {BUILT_DIR}")


if __name__ == "__main__":
    main()
