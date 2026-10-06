from __future__ import annotations

from pathlib import Path

from syncsubtitles.ffmpeg_backend import extract_subtitle
from syncsubtitles.models import SubtitleTrackSpec
from syncsubtitles.subformats import SubtitleDocument, read_file

SUBTITLE_EXTENSIONS = {".srt", ".ass", ".ssa"}


def parse_track_spec(raw: str) -> SubtitleTrackSpec:
    """``file.srt`` / ``file.ass`` (a standalone file) or ``file.mkv@N``
    (subtitle stream N of a container, 0-based among subtitle streams).

    ``@`` rather than ``:`` so Windows drive letters are never ambiguous; a
    container without ``@N`` means its first subtitle stream.
    """
    if "@" in raw:
        path, _, index = raw.rpartition("@")
        if index.isdigit():
            return SubtitleTrackSpec(raw, path, int(index))
    if Path(raw).suffix.lower() in SUBTITLE_EXTENSIONS:
        return SubtitleTrackSpec(raw, raw, None)
    return SubtitleTrackSpec(raw, raw, 0)


def load_track(spec: SubtitleTrackSpec) -> SubtitleDocument:
    if spec.is_external:
        return read_file(spec.path)
    return extract_subtitle(spec.path, spec.stream_index or 0)
