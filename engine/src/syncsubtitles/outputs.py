"""Where a batch's exports go (same rule as SyncAudio's).

In an output folder other than the source's, an export keeps the source's
name ("Film.mp4" -> "Film.mkv", "show 1x01.fr.srt" as is) unless a file
there already has it or another export of the batch takes it; otherwise,
and next to the sources, it's the ".synced" name. Exports that would still
share a name are numbered ("Film.synced (2).mkv").
"""

from __future__ import annotations

import os
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class OutputName:
    # The file the export comes from (where "next to the source" is).
    source: Path
    # Its name in another folder, when free.
    plain: str
    # Its name otherwise.
    synced: str


def _key(path: Path) -> str:
    return os.path.normcase(os.path.abspath(path))


def plan_outputs(names: Sequence[OutputName], folder: str | Path | None) -> list[Path]:
    planned: list[Path] = []
    taken: set[str] = set()

    def free(path: Path) -> bool:
        return _key(path) not in taken

    for name in names:
        chosen = None
        if folder is not None and _key(Path(folder)) != _key(name.source.parent):
            keep = Path(folder) / name.plain
            if free(keep) and not keep.exists():
                chosen = keep
        if chosen is None:
            base = Path(folder if folder is not None else name.source.parent) / name.synced
            chosen, n = base, 2
            while not free(chosen) or _key(chosen) == _key(name.source):
                chosen = base.with_name(f"{base.stem} ({n}){base.suffix}")
                n += 1
        planned.append(chosen)
        taken.add(_key(chosen))
    return planned
