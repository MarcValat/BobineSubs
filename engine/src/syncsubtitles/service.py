"""What the CLI and the HTTP sidecar both do: analyze a pair of tracks, write the result.

Messages (``log``, warnings, errors) are in French, the UI's language.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass, field, replace
from pathlib import Path

from syncsubtitles.cleanup import clean as clean_document
from syncsubtitles.detect import detect_constant
from syncsubtitles.ffmpeg_backend import extract_subtitles, probe_subtitle_streams
from syncsubtitles.filters import plain_text
from syncsubtitles.i18n import tr
from syncsubtitles.languages import guess_language, language_code
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
    # What the cleanup would fix in the corrected file, by kind (see
    # cleanup.clean): the export says what it did.
    cleanup: dict[str, int] = field(default_factory=dict)

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
    _, cleanup = clean_document(retime(tgt_doc, segments), _source_language(pair.target))

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
        cleanup=dict(cleanup),
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
    # What the cleanup fixed, by kind (see cleanup.clean).
    cleaned: dict[str, int] = field(default_factory=dict)


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
    clean: bool = True,
    replaces: int | None = None,
    replace_same_language: bool = False,
) -> Written:
    """Retime the target by ``segments`` and write it: a standalone
    subtitle file, or a new MKV (the reference's) where it replaces the
    original track (same file) or is added (anything else). ``clean``:
    its obvious faults fixed too (see cleanup)."""
    if subs_only or (output and Path(output).suffix.lower() in SUBTITLE_EXTENSIONS):
        corrected, dropped, cleaned = _retimed(target, segments, log, clean, language or _source_language(target))
        out = Path(output) if output else default_subtitle_output(target, corrected.fmt)
        write_subtitle(corrected, out)
        return Written(out, "subtitles", None, dropped, cleaned)
    track = TrackToWrite(target, segments, language, title, default, replaces, replace_same_language)
    return write_tracks(reference, [track], output, log, clean)[0]


def _source_language(target: SubtitleTrackSpec) -> str | None:
    """The target's language: its file name's, or its track's."""
    if target.is_external:
        return guess_language(target.path)
    return probe_subtitle_streams(target.path)[target.stream_index or 0].language


@dataclass(frozen=True)
class TrackToWrite:
    """A corrected track for write_tracks: its source, its segments, and
    what the new track says of itself (None: the source's, see write_tracks)."""

    target: SubtitleTrackSpec
    segments: Sequence[Segment]
    language: str | None = None
    title: str | None = None
    default: bool | None = None
    # A track of the reference's file (subtitle index) this one takes the
    # place of: a standalone file replacing a poor track of the video.
    replaces: int | None = None
    # Without ``replaces``: take the place of the reference file's track in
    # the same language, if there's one (not a forced one), else be added.
    replace_same_language: bool = False


def _retimed(
    target: SubtitleTrackSpec, segments: Sequence[Segment], log: Log, clean: bool, language: str | None
) -> tuple[SubtitleDocument, list[tuple[float, str]], dict[str, int]]:
    """The target retimed by ``segments`` (and cleaned, in ``language``),
    the lines that fell off, and what the cleanup fixed."""
    if not target.is_external and target.stream_index is None:
        raise AnalysisError(tr("Piste cible non précisée."))
    log(tr("Lecture de la piste à corriger…"))
    document = load_target(target)
    dropped = [
        (c.start, plain_text(c.text).strip())
        for c, m in zip(document.cues, corrected_cues(document, segments))
        if m is None or m[1] <= 0
    ]
    corrected = retime(document, segments)
    if not clean:
        return corrected, dropped, {}
    corrected, fixed = clean_document(corrected, language)
    return corrected, dropped, dict(fixed)


def _with_same_language_replaced(track: TrackToWrite, streams: list, taken: list[int | None]) -> TrackToWrite:
    """``track`` replacing the reference file's track in its language
    (``replace_same_language``), the first full one not taken already (by
    ``taken``, extended with it); as is when there's none."""
    if not track.replace_same_language or track.replaces is not None or not track.target.is_external:
        return track
    language = language_code(track.language or guess_language(track.target.path))
    # By its place among the subtitle tracks, as ``replaces`` counts.
    for index, stream in enumerate(streams):
        if language and language_code(stream.language) == language and not stream.forced and index not in taken:
            taken.append(index)
            return replace(track, replaces=index)
    return track


def write_tracks(
    reference: SubtitleTrackSpec,
    tracks: Sequence[TrackToWrite],
    output: str | None = None,
    log: Log = _no_log,
    clean: bool = True,
) -> list[Written]:
    """A new MKV (the reference's) with every track of ``tracks`` retimed:
    one of the reference's own tracks takes its place, any other is added.
    The new track keeps its source's language, title and flags unless told
    otherwise; an added standalone file takes the language its name says,
    one replacing a track (``replaces``) that track's title and flags."""
    if reference.is_external:
        raise AnalysisError(tr("La référence est un fichier de sous-titres seul : pas de MKV où ajouter la piste."))
    out = Path(output) if output else default_mkv_output(reference.path)
    if same_file(out, reference.path) or any(
        not t.target.is_external and same_file(out, t.target.path) for t in tracks
    ):
        raise AnalysisError(tr("Le fichier de sortie ne peut pas être un fichier d'origine."))

    replaced = [
        t.replaces if t.replaces is not None else t.target.stream_index
        for t in tracks
        if t.replaces is not None or (not t.target.is_external and same_file(t.target.path, reference.path))
    ]
    if len(replaced) != len(set(replaced)):
        raise AnalysisError(tr("Deux pistes corrigées prennent la place de la même piste."))
    lookup = any(t.replaces is not None or t.replace_same_language for t in tracks)
    streams = probe_subtitle_streams(reference.path) if lookup else []
    tracks = [_with_same_language_replaced(t, streams, replaced) for t in tracks]

    muxed: list[MuxTrack] = []
    written: list[Written] = []
    for track in tracks:
        target = track.target
        replace_index = None
        metadata = TrackMetadata(
            language=track.language or guess_language(target.path), title=track.title, default=bool(track.default)
        )
        if track.replaces is not None:
            if not 0 <= track.replaces < len(streams):
                raise AnalysisError(tr("La piste à remplacer n'existe pas dans la vidéo."))
            old = streams[track.replaces]
            replace_index = track.replaces
            metadata = TrackMetadata(
                language=track.language or guess_language(target.path) or old.language,
                title=track.title or old.title,
                default=old.default if track.default is None else track.default,
                forced=old.forced,
            )
        elif not target.is_external:
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
        corrected, dropped, cleaned = _retimed(target, track.segments, log, clean, metadata.language)
        muxed.append(MuxTrack(corrected, metadata, replace_index))
        written.append(
            Written(out, "replaced" if replace_index is not None else "added", metadata.language, dropped, cleaned)
        )
    log(tr("Écriture du MKV…"))
    mux_tracks(reference.path, muxed, out)
    return written
