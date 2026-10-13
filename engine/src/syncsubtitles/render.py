from __future__ import annotations

import os
import tempfile
from dataclasses import dataclass
from pathlib import Path

from syncsubtitles.ffmpeg_backend import FFmpegError, probe_streams, remux_shift, resolve_ffmpeg, run_checked
from syncsubtitles.i18n import tr
from syncsubtitles.matroska import MatroskaError, cluster_timestamps, out_of_order
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


@dataclass(frozen=True)
class MuxTrack:
    """A corrected subtitle track to write into the MKV: in place of
    subtitle track ``replace_index`` (``0:s:N``), or added (None)."""

    document: SubtitleDocument
    metadata: TrackMetadata
    replace_index: int | None = None


def mux(
    container: str,
    document: SubtitleDocument,
    output: str | Path,
    metadata: TrackMetadata,
    replace_index: int | None = None,
) -> None:
    """Write ``container`` to ``output`` with ``document`` as a subtitle
    track (see mux_tracks)."""
    mux_tracks(container, [MuxTrack(document, metadata, replace_index)], output)


def mux_tracks(container: str, tracks: list[MuxTrack], output: str | Path) -> None:
    """Write ``container`` to ``output`` with ``tracks`` as subtitle tracks.

    A track with ``replace_index`` takes that track's place; the others are
    added, in their order, after the existing subtitles. Everything else is
    stream-copied, in its original order, with chapters, tags and
    attachments (fonts).
    """
    streams = probe_streams(container)
    subtitles = [s for s in streams if s.kind == "Subtitle"]
    # Input k + 1 is track k's corrected file.
    replacing = {subtitles[t.replace_index].index: k for k, t in enumerate(tracks) if t.replace_index is not None}
    added = [k for k, t in enumerate(tracks) if t.replace_index is None]
    # New tracks go after the last subtitle, else after the last audio/video
    # stream: attachments stay at the end.
    media = [s for s in streams if s.kind in ("Video", "Audio", "Subtitle")]
    insert_after = (subtitles or media)[-1].index if media else None

    maps: list[str] = []
    positions: dict[int, int] = {}

    def place(k: int) -> None:
        positions[k] = len(maps) // 2
        maps.extend(["-map", f"{k + 1}:0"])

    if insert_after is None:
        for k in added:
            place(k)
    for stream in streams:
        if stream.index in replacing:
            place(replacing[stream.index])
        else:
            maps.extend(["-map", f"0:{stream.index}"])
        if stream.index == insert_after:
            for k in added:
                place(k)

    tags: list[str] = []
    for k, track in enumerate(tracks):
        metadata, position = track.metadata, positions[k]
        if metadata.language:
            tags += [f"-metadata:s:{position}", f"language={metadata.language}"]
        if metadata.title:
            tags += [f"-metadata:s:{position}", f"title={metadata.title}"]
        flags = [name for name, on in (("default", metadata.default), ("forced", metadata.forced)) if on]
        tags += [f"-disposition:{position}", "+".join(flags) or "0"]

    output = Path(output)
    # Written under another name and renamed once complete: a failed or
    # cancelled export leaves nothing half-written behind.
    partial = output.with_name(f"{output.stem}.part{output.suffix}")
    try:
        with tempfile.TemporaryDirectory(prefix="syncsubtitles-") as tmp:
            inputs: list[str] = []
            # See remux_shift: keeps the new tracks in place against the video.
            shift = f"{remux_shift(container):.6f}"
            for k, track in enumerate(tracks):
                corrected = Path(tmp) / f"corrected{k}.{track.document.fmt}"
                write_subtitle(track.document, corrected)
                inputs += ["-itsoffset", shift, "-i", str(corrected)]
            run_checked(
                [
                    resolve_ffmpeg(),
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-y",
                    "-i",
                    container,
                    *inputs,
                    *maps,
                    "-map_metadata",
                    "0",
                    "-map_chapters",
                    "0",
                    *tags,
                    "-c",
                    "copy",
                    # Waits for every stream before writing a cluster: by
                    # default ffmpeg stops waiting for one lagging 10 s, and
                    # sparse subtitles read from their own file then land in
                    # clusters out of order (found in Bobine Style: one at
                    # 3:19 before one at 0:14). VLC skips those blocks: the
                    # lines never show.
                    "-max_interleave_delta",
                    "0",
                    "-f",
                    "matroska",
                    str(partial),
                ]
            )
        check_cluster_order(partial)
        os.replace(partial, output)
    finally:
        partial.unlink(missing_ok=True)


def check_cluster_order(path: str | Path) -> None:
    """Refuses a written file whose clusters go back in time: VLC skips the
    blocks of one written too early (subtitles that never show), however
    well ffmpeg itself reads it."""
    try:
        backwards = out_of_order(cluster_timestamps(path))
    except (MatroskaError, OSError) as exc:
        raise FFmpegError(tr("Fichier écrit illisible : {error}", error=exc)) from exc
    if backwards:
        raise FFmpegError(
            tr(
                "{count} groupe(s) de blocs hors de l'ordre du temps : certains lecteurs n'afficheraient pas tout",
                count=backwards,
            )
        )
