"""What the CLI and the HTTP sidecar both do: analyze a pair of tracks, write the result.

Messages (``log``, warnings, errors) are in French, the UI's language.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from pathlib import Path

from syncsubtitles.detect import detect_constant
from syncsubtitles.ffmpeg_backend import extract_subtitles, probe_subtitle_streams
from syncsubtitles.filters import plain_text
from syncsubtitles.i18n import tr
from syncsubtitles.languages import guess_language
from syncsubtitles.models import SubtitleTrackSpec
from syncsubtitles.render import (
    MuxTrack,
    TrackMetadata,
    default_mkv_output,
    default_subtitle_output,
    mux_tracks,
    write_subtitle,
)
from syncsubtitles.retime import Segment, remap_cue, retime
from syncsubtitles.segments import STANDARD_RATIOS, detect_segments
from syncsubtitles.subformats import SubtitleDocument, read_file
from syncsubtitles.tracks import SUBTITLE_EXTENSIONS, load_pair, same_file

Log = Callable[[str], None]


def _no_log(_message: str) -> None:
    pass


# A reference with far fewer lines than the target is likely a forced track.
_FEW_REFERENCE_LINES = 0.4
# Below this share of a segment's lines landing on reference lines, flag it.
LOW_CONFIDENCE = 0.8


# ratio = target time / reference time: below 1 the target runs fast.
def _ratio_names() -> dict[float, str]:
    """The standard frame-rate conversions, named in the current language."""
    return {
        STANDARD_RATIOS[1]: tr("cible ralentie (25 -> 23,976 i/s)"),
        STANDARD_RATIOS[2]: tr("cible accélérée (23,976 -> 25 i/s, PAL)"),
        STANDARD_RATIOS[3]: tr("cible ralentie (24 -> 23,976 i/s)"),
        STANDARD_RATIOS[4]: tr("cible accélérée (23,976 -> 24 i/s)"),
        STANDARD_RATIOS[5]: tr("cible ralentie (25 -> 24 i/s)"),
        STANDARD_RATIOS[6]: tr("cible accélérée (24 -> 25 i/s)"),
    }


class AnalysisError(ValueError):
    """A pair of tracks that can't be analyzed (message for the user)."""


@dataclass
class TargetCue:
    start: float
    end: float
    text: str
    # Segment the line was matched in, -1: no counterpart in the reference
    # (or not a spoken line, see filters).
    group: int
    # Where it lands once corrected, None: dropped.
    corrected: tuple[float, float] | None


@dataclass
class Analysis:
    reference: SubtitleTrackSpec
    target: SubtitleTrackSpec
    reference_choice: str | None
    ratio: float
    segments: list[Segment]
    # (start, end, text); no text for image subtitles.
    reference_cues: list[tuple[float, float, str]]
    target_cues: list[TargetCue]
    warnings: list[str] = field(default_factory=list)

    @property
    def ratio_name(self) -> str | None:
        if self.ratio == 1.0:
            return None
        return _ratio_names().get(self.ratio) or tr("rapport {ratio:.5f}", ratio=self.ratio)


def analyze(
    reference: SubtitleTrackSpec, target: SubtitleTrackSpec, constant: bool = False, log: Log = _no_log
) -> Analysis:
    log(tr("Lecture des pistes de sous-titres…"))
    try:
        pair = load_pair(reference, target)
    except (ValueError, OSError) as exc:
        raise AnalysisError(str(exc)) from exc
    ref_doc, tgt_doc = pair.reference_doc, pair.target_doc
    if pair.reference_choice:
        log(tr("Référence choisie : {choice}", choice=pair.reference_choice))
    if not tgt_doc.is_text:
        raise AnalysisError(
            tr("La cible est en {fmt} (sous-titres image) : seuls SRT et ASS peuvent être recalés.", fmt=tgt_doc.fmt)
        )
    if not ref_doc.cues or not tgt_doc.cues:
        raise AnalysisError(tr("Une des deux pistes ne contient aucune réplique."))
    log(
        tr(
            "Référence : {reference} répliques, cible : {target} répliques",
            reference=len(ref_doc.cues),
            target=len(tgt_doc.cues),
        )
    )

    warnings = []
    if len(ref_doc.cues) < _FEW_REFERENCE_LINES * len(tgt_doc.cues):
        warnings.append(
            tr("La référence a bien moins de répliques que la cible : piste forcée ? Choisis-en une autre.")
        )

    log(tr("Recherche des décalages…"))
    groups: dict[int, int] = {}
    if constant:
        detection = detect_constant(ref_doc, tgt_doc)
        segments, ratio = detection.segments, 1.0
        groups = {i: 0 for i in range(len(tgt_doc.cues))}
        if detection.ambiguous:
            warnings.append(tr("Résultat ambigu : un autre décalage correspond presque aussi bien."))
    else:
        detection = detect_segments(ref_doc, tgt_doc)
        segments, ratio = detection.segments, detection.ratio
        groups = {m.index: m.group for m in detection.matches}
    if any(seg.confidence < LOW_CONFIDENCE for seg in segments):
        warnings.append(tr("Certains segments sont peu fiables : vérifie-les."))
    log(tr("{count} segment(s) trouvé(s)", count=len(segments)))

    return Analysis(
        reference=pair.reference,
        target=pair.target,
        reference_choice=pair.reference_choice,
        ratio=ratio,
        segments=segments,
        reference_cues=[(c.start, c.end, plain_text(c.text).strip()) for c in ref_doc.cues],
        target_cues=[
            TargetCue(c.start, c.end, plain_text(c.text).strip(), groups.get(i, -1), remap_cue(c, segments))
            for i, c in enumerate(tgt_doc.cues)
        ],
        warnings=warnings,
    )


def corrected_cues(document: SubtitleDocument, segments: Sequence[Segment]) -> list[tuple[float, float] | None]:
    return [remap_cue(c, segments) for c in document.cues]


def load_target(target: SubtitleTrackSpec) -> SubtitleDocument:
    if target.is_external:
        return read_file(target.path)
    return extract_subtitles(target.path, [target.stream_index or 0])[target.stream_index or 0]


@dataclass(frozen=True)
class Written:
    path: Path
    # "subtitles": a standalone file; "replaced"/"added": a new MKV.
    kind: str
    language: str | None
    dropped: list[tuple[float, str]]


def write_result(
    reference: SubtitleTrackSpec,
    target: SubtitleTrackSpec,
    segments: Sequence[Segment],
    output: str | None = None,
    subs_only: bool = False,
    language: str | None = None,
    title: str | None = None,
    default: bool | None = None,
    log: Log = _no_log,
) -> Written:
    """Retime the target by ``segments`` and write it: a standalone
    subtitle file, or a new MKV (the reference's) where it replaces the
    original track (same file) or is added (anything else)."""
    if subs_only or (output and Path(output).suffix.lower() in SUBTITLE_EXTENSIONS):
        corrected, dropped = _retimed(target, segments, log)
        out = Path(output) if output else default_subtitle_output(target, corrected.fmt)
        write_subtitle(corrected, out)
        return Written(out, "subtitles", None, dropped)
    return write_tracks(reference, [TrackToWrite(target, segments, language, title, default)], output, log)[0]


@dataclass(frozen=True)
class TrackToWrite:
    """A corrected track for write_tracks: its source, its segments, and
    what the new track says of itself (None: the source's, see write_tracks)."""

    target: SubtitleTrackSpec
    segments: Sequence[Segment]
    language: str | None = None
    title: str | None = None
    default: bool | None = None


def _retimed(
    target: SubtitleTrackSpec, segments: Sequence[Segment], log: Log
) -> tuple[SubtitleDocument, list[tuple[float, str]]]:
    """The target retimed by ``segments``, and the lines that fell off."""
    if not target.is_external and target.stream_index is None:
        raise AnalysisError(tr("Piste cible non précisée."))
    log(tr("Lecture de la piste à corriger…"))
    document = load_target(target)
    dropped = [
        (c.start, plain_text(c.text).strip())
        for c, m in zip(document.cues, corrected_cues(document, segments))
        if m is None or m[1] <= 0
    ]
    return retime(document, segments), dropped


def write_tracks(
    reference: SubtitleTrackSpec,
    tracks: Sequence[TrackToWrite],
    output: str | None = None,
    log: Log = _no_log,
) -> list[Written]:
    """A new MKV (the reference's) with every track of ``tracks`` retimed:
    one of the reference's own tracks takes its place, any other is added.
    The new track keeps its source's language, title and flags unless told
    otherwise; an added standalone file takes the language its name says."""
    if reference.is_external:
        raise AnalysisError(tr("La référence est un fichier de sous-titres seul : pas de MKV où ajouter la piste."))
    out = Path(output) if output else default_mkv_output(reference.path)
    if same_file(out, reference.path) or any(
        not t.target.is_external and same_file(out, t.target.path) for t in tracks
    ):
        raise AnalysisError(tr("Le fichier de sortie ne peut pas être un fichier d'origine."))

    muxed: list[MuxTrack] = []
    written: list[Written] = []
    for track in tracks:
        target = track.target
        corrected, dropped = _retimed(target, track.segments, log)
        replace_index = None
        metadata = TrackMetadata(
            language=track.language or guess_language(target.path), title=track.title, default=bool(track.default)
        )
        if not target.is_external:
            source = probe_subtitle_streams(target.path)[target.stream_index]
            if same_file(target.path, reference.path):
                replace_index = target.stream_index
            metadata = TrackMetadata(
                language=track.language or source.language,
                title=track.title or source.title,
                default=(source.default if replace_index is not None else False)
                if track.default is None
                else track.default,
                forced=source.forced,
            )
        muxed.append(MuxTrack(corrected, metadata, replace_index))
        written.append(Written(out, "replaced" if replace_index is not None else "added", metadata.language, dropped))
    log(tr("Écriture du MKV…"))
    mux_tracks(reference.path, muxed, out)
    return written
