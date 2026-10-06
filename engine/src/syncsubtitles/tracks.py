from __future__ import annotations

from dataclasses import dataclass, replace
from pathlib import Path

from syncsubtitles.ffmpeg_backend import extract_subtitles, probe_subtitle_streams, subtitle_format
from syncsubtitles.models import SubtitleTrackSpec
from syncsubtitles.subformats import SubtitleDocument, read_file

SUBTITLE_EXTENSIONS = {".srt", ".ass", ".ssa"}


def parse_track_spec(raw: str) -> SubtitleTrackSpec:
    """``file.srt`` / ``file.ass`` (a standalone file), ``file.mkv@N``
    (subtitle stream N of a container, 0-based among subtitle streams) or
    ``file.mkv`` (a stream of it, to be chosen).

    ``@`` rather than ``:`` so Windows drive letters are never ambiguous.
    """
    if "@" in raw:
        path, _, index = raw.rpartition("@")
        if index.isdigit():
            return SubtitleTrackSpec(raw, path, int(index))
    if Path(raw).suffix.lower() in SUBTITLE_EXTENSIONS:
        return SubtitleTrackSpec(raw, raw, None, is_external=True)
    return SubtitleTrackSpec(raw, raw, None)


def same_file(a: str | Path, b: str | Path) -> bool:
    return Path(a).resolve() == Path(b).resolve()


@dataclass(frozen=True)
class TrackPair:
    reference: SubtitleTrackSpec  # stream_index always set if not external
    target: SubtitleTrackSpec
    reference_doc: SubtitleDocument
    target_doc: SubtitleDocument
    # Why this reference was picked, when it was.
    reference_choice: str | None = None


def _target_index(spec: SubtitleTrackSpec) -> int:
    if spec.stream_index is not None:
        return spec.stream_index
    text = [s for s in probe_subtitle_streams(spec.path) if (subtitle_format(s.codec) or "") in ("srt", "ass")]
    if len(text) == 1:
        return text[0].index
    raise ValueError(
        f"{spec.path} has {len(text)} text subtitle tracks: say which one to correct with {spec.path}@N (see `probe`)."
    )


def load_pair(reference: SubtitleTrackSpec, target: SubtitleTrackSpec) -> TrackPair:
    """Load both tracks, extracting everything a container provides in one pass.

    A container reference without ``@N`` gets its fullest non-forced track
    (excluding the target): a forced track only has a few lines, a poor
    reference.
    """
    if not target.is_external:
        target = replace(target, stream_index=_target_index(target))
    if not target.is_external and not reference.is_external and same_file(reference.path, target.path):
        if reference.stream_index == target.stream_index:
            raise ValueError("The reference and the target are the same track.")

    wanted: dict[str, list[int]] = {}
    candidates: list[int] = []
    if not reference.is_external:
        if reference.stream_index is None:
            excluded = target.stream_index if not target.is_external and same_file(reference.path, target.path) else None
            candidates = [
                s.index
                for s in probe_subtitle_streams(reference.path)
                if s.index != excluded and subtitle_format(s.codec) is not None
            ]
            if not candidates:
                raise ValueError(f"No usable reference subtitle track in {reference.path}.")
            wanted.setdefault(reference.path, []).extend(candidates)
        else:
            wanted.setdefault(reference.path, []).append(reference.stream_index)
    if not target.is_external:
        key = next((k for k in wanted if same_file(k, target.path)), target.path)
        wanted.setdefault(key, []).append(target.stream_index)

    extracted = {path: extract_subtitles(path, indices) for path, indices in wanted.items()}

    def doc(spec: SubtitleTrackSpec, index: int) -> SubtitleDocument:
        if spec.is_external:
            return read_file(spec.path)
        return extracted[next(k for k in extracted if same_file(k, spec.path))][index]

    choice = None
    if not reference.is_external and reference.stream_index is None:
        streams = {s.index: s for s in probe_subtitle_streams(reference.path)}
        best = max(candidates, key=lambda i: (not streams[i].forced, len(doc(reference, i).cues)))
        s = streams[best]
        choice = (
            f"@{best} ({s.codec}, {s.language or 'langue ?'}{', ' + s.title if s.title else ''}, "
            f"{len(doc(reference, best).cues)} répliques)"
        )
        reference = replace(reference, stream_index=best)

    return TrackPair(
        reference,
        target,
        doc(reference, reference.stream_index if reference.stream_index is not None else -1),
        doc(target, target.stream_index if target.stream_index is not None else -1),
        choice,
    )
