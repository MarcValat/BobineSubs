from __future__ import annotations

import sys
from pathlib import Path

import click

from syncsubtitles.detect import Detection, detect_constant
from syncsubtitles.ffmpeg_backend import FFmpegError, probe_subtitle_streams
from syncsubtitles.languages import guess_language
from syncsubtitles.render import TrackMetadata, default_mkv_output, default_subtitle_output, mux, write_subtitle
from syncsubtitles.retime import retime
from syncsubtitles.subformats import format_for_codec
from syncsubtitles.tracks import SUBTITLE_EXTENSIONS, load_track, parse_track_spec

def _fail(message: str) -> None:
    click.echo(f"Erreur : {message}", err=True)
    sys.exit(1)


def _same_file(a: str, b: str) -> bool:
    return Path(a).resolve() == Path(b).resolve()


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
        usable = "" if format_for_codec(s.codec) else "  (image : pas encore supporté)"
        click.echo(
            f"@{s.index}  {s.codec:<18} {s.language or '-':<5} {s.title or '':<30} {' '.join(flags)}{usable}".rstrip()
        )


def _detect(reference: str, target: str):
    ref_spec, tgt_spec = parse_track_spec(reference), parse_track_spec(target)
    try:
        ref_doc, tgt_doc = load_track(ref_spec), load_track(tgt_spec)
    except (FFmpegError, ValueError, OSError) as exc:
        _fail(str(exc))
    click.echo(f"[référence] {len(ref_doc.cues)} répliques   [cible] {len(tgt_doc.cues)} répliques")
    detection = detect_constant(ref_doc, tgt_doc)
    _report(detection)
    return ref_spec, tgt_spec, tgt_doc, detection


def _report(detection: Detection) -> None:
    offset = detection.segments[0].offset_start
    direction = "en retard" if offset > 0 else "en avance"
    click.echo(f"Décalage : {offset:+.3f} s (la cible est {direction})   score {detection.score:.2f}")
    if detection.ambiguous:
        click.echo("⚠ Résultat ambigu : un autre décalage correspond presque aussi bien, vérifie le résultat.")
    if detection.score < 0.5:
        click.echo("⚠ Score faible : les deux pistes se ressemblent peu, ce ne sont peut-être pas les mêmes répliques.")


@main.command()
@click.argument("reference")
@click.argument("target")
def align(reference: str, target: str) -> None:
    """Mesure le décalage de TARGET par rapport à REFERENCE.

    \b
    REFERENCE, TARGET : file.srt / file.ass, ou file.mkv@N (N = piste de sous-titres, depuis 0, voir `probe`)."""
    _detect(reference, target)


@main.command()
@click.argument("reference")
@click.argument("target")
@click.option("-o", "--output", type=click.Path(dir_okay=False), help="Fichier de sortie (.mkv, ou .srt/.ass pour les sous-titres seuls).")
@click.option("--subs-only", is_flag=True, help="Écrit seulement le fichier de sous-titres corrigé, sans remux.")
@click.option("--language", help="Langue de la piste ajoutée (code ISO 639-2, ex. fre). Par défaut : devinée du nom de fichier.")
@click.option("--title", help="Titre de la piste ajoutée.")
@click.option("--default/--no-default", "default", default=None, help="Marque la piste comme piste par défaut.")
def render(reference: str, target: str, output: str | None, subs_only: bool, language: str | None, title: str | None, default: bool | None) -> None:
    """Recale TARGET sur REFERENCE et écrit le résultat.

    \b
    Par défaut, un nouveau MKV à côté de la référence (Film.synced.mkv) :
    - TARGET dans le même MKV : la piste corrigée remplace l'originale ;
    - TARGET externe (SRT/ASS) : elle est ajoutée au MKV.
    Le fichier d'origine n'est jamais modifié.

    \b
    REFERENCE, TARGET : file.srt / file.ass, ou file.mkv@N (N = piste de sous-titres, depuis 0, voir `probe`)."""
    ref_spec, tgt_spec, tgt_doc, detection = _detect(reference, target)
    corrected = retime(tgt_doc, detection.segments)
    dropped = len(tgt_doc.cues) - len(corrected.cues)
    if dropped:
        click.echo(f"{dropped} réplique(s) tombée(s) avant le début de la vidéo, retirée(s).")

    if subs_only or (output and Path(output).suffix.lower() in SUBTITLE_EXTENSIONS):
        out = Path(output) if output else default_subtitle_output(tgt_spec, corrected.fmt)
        write_subtitle(corrected, out)
        click.echo(f"Écrit : {out}")
        return

    if ref_spec.is_external:
        _fail("la référence est un fichier de sous-titres seul : pas de MKV où ajouter la piste (utilise --subs-only).")
    out = Path(output) if output else default_mkv_output(ref_spec.path)
    if _same_file(out, ref_spec.path):
        _fail("le fichier de sortie ne peut pas être le fichier d'origine.")

    replace_index = None
    metadata = TrackMetadata(language=language or guess_language(tgt_spec.path), title=title, default=bool(default))
    if not tgt_spec.is_external and _same_file(tgt_spec.path, ref_spec.path):
        replace_index = tgt_spec.stream_index
        original = probe_subtitle_streams(ref_spec.path)[replace_index]
        metadata = TrackMetadata(
            language=language or original.language,
            title=title or original.title,
            default=original.default if default is None else default,
            forced=original.forced,
        )
    elif not tgt_spec.is_external:
        source = probe_subtitle_streams(tgt_spec.path)[tgt_spec.stream_index or 0]
        metadata = TrackMetadata(
            language=language or source.language, title=title or source.title, default=bool(default), forced=source.forced
        )

    try:
        mux(ref_spec.path, corrected, out, metadata, replace_index)
    except FFmpegError as exc:
        _fail(str(exc))
    action = "remplacée" if replace_index is not None else "ajoutée"
    click.echo(f"Écrit : {out} (piste {action}, langue {metadata.language or 'non précisée'})")
