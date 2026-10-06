from __future__ import annotations

import sys
from pathlib import Path

import click

from syncsubtitles.detect import Detection, detect_constant
from syncsubtitles.ffmpeg_backend import FFmpegError, probe_subtitle_streams, subtitle_format
from syncsubtitles.languages import guess_language
from syncsubtitles.render import TrackMetadata, default_mkv_output, default_subtitle_output, mux, write_subtitle
from syncsubtitles.retime import remap_cue, retime
from syncsubtitles.segments import STANDARD_RATIOS, SegmentDetection, detect_segments
from syncsubtitles.tracks import SUBTITLE_EXTENSIONS, load_pair, parse_track_spec, same_file

# A reference with far fewer lines than the target is likely a forced track.
_FEW_REFERENCE_LINES = 0.4


def _fail(message: str) -> None:
    click.echo(f"Erreur : {message}", err=True)
    sys.exit(1)


@click.group()
def main() -> None:
    """Recale une piste de sous-titres sur une piste de référence."""
    # Windows consoles default to cp1252: accented titles would crash echo.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")


@main.command()
@click.argument("file", type=click.Path(exists=True, dir_okay=False))
def probe(file: str) -> None:
    """Liste les pistes de sous-titres d'un fichier."""
    try:
        streams = probe_subtitle_streams(file)
    except FFmpegError as exc:
        _fail(str(exc))
    if not streams:
        click.echo("Aucune piste de sous-titres.")
    for s in streams:
        flags = [f for f, on in (("défaut", s.default), ("forcés", s.forced)) if on]
        fmt = subtitle_format(s.codec)
        usable = "  (non supporté)" if fmt is None else "  (image : référence seulement)" if fmt in ("pgs", "vobsub") else ""
        click.echo(
            f"@{s.index}  {s.codec:<18} {s.language or '-':<5} {s.title or '':<30} {' '.join(flags)}{usable}".rstrip()
        )


# ratio = target time / reference time: below 1 the target runs fast.
_RATIO_NAMES = {
    STANDARD_RATIOS[1]: "cible ralentie (25 -> 23,976 i/s)",
    STANDARD_RATIOS[2]: "cible accélérée (23,976 -> 25 i/s, PAL)",
    STANDARD_RATIOS[3]: "cible ralentie (24 -> 23,976 i/s)",
    STANDARD_RATIOS[4]: "cible accélérée (23,976 -> 24 i/s)",
    STANDARD_RATIOS[5]: "cible ralentie (25 -> 24 i/s)",
    STANDARD_RATIOS[6]: "cible accélérée (24 -> 25 i/s)",
}
# Below this share of a segment's lines landing on reference lines, flag it.
_LOW_CONFIDENCE = 0.8


def _clock(t: float) -> str:
    sign = "-" if t < 0 else ""
    t = abs(t)
    return f"{sign}{int(t // 3600)}:{int(t % 3600 // 60):02d}:{t % 60:06.3f}"


def _detect(reference: str, target: str, constant: bool):
    try:
        pair = load_pair(parse_track_spec(reference), parse_track_spec(target))
    except (FFmpegError, ValueError, OSError) as exc:
        _fail(str(exc))
    ref_doc, tgt_doc = pair.reference_doc, pair.target_doc
    if pair.reference_choice:
        click.echo(f"Référence choisie : {pair.reference_choice}")
    if not tgt_doc.is_text:
        _fail(f"la cible est en {tgt_doc.fmt} (sous-titres image) : seuls SRT et ASS peuvent être recalés.")
    click.echo(f"[référence] {len(ref_doc.cues)} répliques   [cible] {len(tgt_doc.cues)} répliques")
    if len(ref_doc.cues) < _FEW_REFERENCE_LINES * len(tgt_doc.cues):
        click.echo("⚠ La référence a bien moins de répliques que la cible : piste forcée ? Choisis-en une autre avec @N.")
    try:
        if constant:
            detection = detect_constant(ref_doc, tgt_doc)
            _report_constant(detection)
            return pair, detection.segments
        detection = detect_segments(ref_doc, tgt_doc)
    except ValueError as exc:
        _fail(str(exc))
    _report_segments(detection)
    return pair, detection.segments


def _report_constant(detection: Detection) -> None:
    offset = detection.segments[0].offset_start
    direction = "en retard" if offset > 0 else "en avance"
    click.echo(f"Décalage : {offset:+.3f} s (la cible est {direction})   score {detection.score:.2f}")
    if detection.ambiguous:
        click.echo("⚠ Résultat ambigu : un autre décalage correspond presque aussi bien, vérifie le résultat.")
    if detection.score < 0.5:
        click.echo("⚠ Score faible : les deux pistes se ressemblent peu, ce ne sont peut-être pas les mêmes répliques.")


def _report_segments(detection: SegmentDetection) -> None:
    if detection.ratio != 1.0:
        click.echo(f"Dérive : {_RATIO_NAMES.get(detection.ratio, f'rapport {detection.ratio:.5f}')}")
    counts = [sum(m.group == g for m in detection.matches) for g in range(len(detection.segments))]
    kind = "décalage constant" if len(detection.segments) == 1 else f"{len(detection.segments) - 1} saut(s)"
    click.echo(f"{len(detection.segments)} segment(s), {kind} :")
    for seg, count in zip(detection.segments, counts):
        offset = f"{seg.offset_start:+.3f} s" if not seg.is_drift else f"{seg.offset_start:+.3f} -> {seg.offset_end:+.3f} s"
        warn = "  ⚠ peu fiable" if seg.confidence < _LOW_CONFIDENCE else ""
        click.echo(
            f"  {_clock(seg.start_s)} -> {_clock(seg.end_s)}   {offset:<22} {count:4d} répliques   confiance {seg.confidence:.0%}{warn}"
        )
    orphans = sum(m.group == -1 for m in detection.matches)
    if orphans:
        click.echo(f"{orphans} réplique(s) de la cible sans équivalent dans la référence.")


CONSTANT_OPTION = click.option("--constant", is_flag=True, help="Un seul décalage pour toute la piste (ni dérive, ni sauts).")


@main.command()
@click.argument("reference")
@click.argument("target")
@CONSTANT_OPTION
def align(reference: str, target: str, constant: bool) -> None:
    """Mesure le décalage de TARGET par rapport à REFERENCE (dérive et sauts compris).

    \b
    REFERENCE, TARGET : file.srt / file.ass, ou file.mkv@N (N = piste de sous-titres, depuis 0,
    voir `probe`). Sans @N, la référence est la piste la plus complète du MKV."""
    _detect(reference, target, constant)


@main.command()
@click.argument("reference")
@click.argument("target")
@click.option("-o", "--output", type=click.Path(dir_okay=False), help="Fichier de sortie (.mkv, ou .srt/.ass pour les sous-titres seuls).")
@click.option("--subs-only", is_flag=True, help="Écrit seulement le fichier de sous-titres corrigé, sans remux.")
@click.option("--language", help="Langue de la piste ajoutée (code ISO 639-2, ex. fre). Par défaut : devinée du nom de fichier.")
@click.option("--title", help="Titre de la piste ajoutée.")
@click.option("--default/--no-default", "default", default=None, help="Marque la piste comme piste par défaut.")
@CONSTANT_OPTION
def render(
    reference: str,
    target: str,
    output: str | None,
    subs_only: bool,
    language: str | None,
    title: str | None,
    default: bool | None,
    constant: bool,
) -> None:
    """Recale TARGET sur REFERENCE et écrit le résultat.

    \b
    Par défaut, un nouveau MKV à côté de la référence (Film.synced.mkv) :
    - TARGET dans le même MKV : la piste corrigée remplace l'originale ;
    - TARGET externe (SRT/ASS) : elle est ajoutée au MKV.
    Le fichier d'origine n'est jamais modifié.

    \b
    REFERENCE, TARGET : file.srt / file.ass, ou file.mkv@N (N = piste de sous-titres, depuis 0,
    voir `probe`). Sans @N, la référence est la piste la plus complète du MKV."""
    pair, segments = _detect(reference, target, constant)
    ref_spec, tgt_spec, tgt_doc = pair.reference, pair.target, pair.target_doc
    corrected = retime(tgt_doc, segments)
    dropped = [c for c in tgt_doc.cues if (m := remap_cue(c, segments)) is None or m[1] <= 0]
    if dropped:
        click.echo(f"{len(dropped)} réplique(s) retirée(s) (avant le début de la vidéo, ou dans une scène absente de la référence) :")
        for cue in dropped:
            text = " / ".join(line.strip() for line in cue.text.replace(r"\N", "\n").splitlines())
            click.echo(f"  {_clock(cue.start)}  {text[:70]}")

    if subs_only or (output and Path(output).suffix.lower() in SUBTITLE_EXTENSIONS):
        out = Path(output) if output else default_subtitle_output(tgt_spec, corrected.fmt)
        write_subtitle(corrected, out)
        click.echo(f"Écrit : {out}")
        return

    if ref_spec.is_external:
        _fail("la référence est un fichier de sous-titres seul : pas de MKV où ajouter la piste (utilise --subs-only).")
    out = Path(output) if output else default_mkv_output(ref_spec.path)
    if same_file(out, ref_spec.path):
        _fail("le fichier de sortie ne peut pas être le fichier d'origine.")

    replace_index = None
    metadata = TrackMetadata(language=language or guess_language(tgt_spec.path), title=title, default=bool(default))
    if not tgt_spec.is_external and same_file(tgt_spec.path, ref_spec.path):
        replace_index = tgt_spec.stream_index
        original = probe_subtitle_streams(ref_spec.path)[replace_index]
        metadata = TrackMetadata(
            language=language or original.language,
            title=title or original.title,
            default=original.default if default is None else default,
            forced=original.forced,
        )
    elif not tgt_spec.is_external:
        source = probe_subtitle_streams(tgt_spec.path)[tgt_spec.stream_index]
        metadata = TrackMetadata(
            language=language or source.language, title=title or source.title, default=bool(default), forced=source.forced
        )

    try:
        mux(ref_spec.path, corrected, out, metadata, replace_index)
    except FFmpegError as exc:
        _fail(str(exc))
    action = "remplacée" if replace_index is not None else "ajoutée"
    click.echo(f"Écrit : {out} (piste {action}, langue {metadata.language or 'non précisée'})")
