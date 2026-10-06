from __future__ import annotations

import tempfile
from dataclasses import dataclass
from pathlib import Path

from syncsubtitles.ffmpeg_backend import probe_streams, remux_shift, resolve_ffmpeg, run_checked
from syncsubtitles.models import SubtitleTrackSpec
from syncsubtitles.subformats import SubtitleDocument


def default_subtitle_output(target: SubtitleTrackSpec, fmt: str) -> Path:
    path = Path(target.path)
    if target.is_external:
        return path.with_name(f"{path.stem}.synced.{fmt}")
    return path.with_name(f"{path.stem}.s{target.stream_index}.synced.{fmt}")


def default_mkv_output(container: str) -> Path:
    path = Path(container)
    return path.with_name(f"{path.stem}.synced.mkv")


def write_subtitle(document: SubtitleDocument, output: str | Path) -> None:
    Path(output).write_text(document.to_text(), encoding="utf-8")


@dataclass(frozen=True)
class TrackMetadata:
    language: str | None = None
    title: str | None = None
    default: bool = False
    forced: bool = False


def mux(
    container: str,
    document: SubtitleDocument,
    output: str | Path,
    metadata: TrackMetadata,
    replace_index: int | None = None,
) -> None:
    """Write ``container`` to ``output`` with ``document`` as a subtitle track.

    With ``replace_index`` (``0:s:N``), the corrected track takes that
    track's place; otherwise it's added after the existing subtitles.
    Everything else is stream-copied, in its original order, with chapters,
    tags and attachments (fonts).
    """
    streams = probe_streams(container)
    subtitles = [s for s in streams if s.kind == "Subtitle"]
    replaced = subtitles[replace_index].index if replace_index is not None else None
    # A new track goes after the last subtitle, else after the last
    # audio/video stream: attachments stay at the end.
    media = [s for s in streams if s.kind in ("Video", "Audio", "Subtitle")]
    insert_after = (subtitles or media)[-1].index if replaced is None and media else None

    maps: list[str] = []
    new_position = 0
    if replaced is None and insert_after is None:
        maps += ["-map", "1:0"]
    for stream in streams:
        if stream.index == replaced:
            new_position = len(maps) // 2
            maps += ["-map", "1:0"]
        else:
            maps += ["-map", f"0:{stream.index}"]
        if replaced is None and stream.index == insert_after:
            new_position = len(maps) // 2
            maps += ["-map", "1:0"]

    tags: list[str] = []
    if metadata.language:
        tags += [f"-metadata:s:{new_position}", f"language={metadata.language}"]
    if metadata.title:
        tags += [f"-metadata:s:{new_position}", f"title={metadata.title}"]
    flags = [name for name, on in (("default", metadata.default), ("forced", metadata.forced)) if on]
    tags += [f"-disposition:{new_position}", "+".join(flags) or "0"]

    with tempfile.TemporaryDirectory(prefix="syncsubtitles-") as tmp:
        corrected = Path(tmp) / f"corrected.{document.fmt}"
        write_subtitle(document, corrected)
        run_checked(
            [
                resolve_ffmpeg(), "-hide_banner", "-loglevel", "error", "-y",
                "-i", container,
                # See remux_shift: keeps the new track in place against the video.
                "-itsoffset", f"{remux_shift(container):.6f}", "-i", str(corrected),
                *maps, "-map_metadata", "0", "-map_chapters", "0",
                *tags, "-c", "copy", str(output),
            ]
        )
