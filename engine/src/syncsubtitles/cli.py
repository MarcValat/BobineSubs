from __future__ import annotations

import os
import sys

import click

from syncsubtitles.ffmpeg_backend import FFmpegError, probe_subtitle_streams, subtitle_format
from syncsubtitles.service import LOW_CONFIDENCE, Analysis, AnalysisError, analyze, write_result
from syncsubtitles.tracks import parse_track_spec

DEFAULT_PORT = 8757


def _fail(message: str) -> None:
    click.echo(f"Erreur : {message}", err=True)
    sys.exit(1)


def _clock(t: float) -> str:
    sign = "-" if t < 0 else ""
    t = abs(t)
    return f"{sign}{int(t // 3600)}:{int(t % 3600 // 60):02d}:{t % 60:06.3f}"


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


def _quiet(_message: str) -> None:
    pass


def _run_analysis(reference: str, target: str, constant: bool) -> Analysis:
    try:
        analysis = analyze(parse_track_spec(reference), parse_track_spec(target), constant, log=_quiet)
    except (AnalysisError, FFmpegError) as exc:
        _fail(str(exc))
    if analysis.reference_choice:
        click.echo(f"Référence choisie : {analysis.reference_choice}")
    click.echo(f"[référence] {len(analysis.reference_cues)} répliques   [cible] {len(analysis.target_cues)} répliques")
    if analysis.ratio_name:
        click.echo(f"Dérive : {analysis.ratio_name}")
    segments = analysis.segments
    kind = "décalage constant" if len(segments) == 1 else f"{len(segments) - 1} saut(s)"
    click.echo(f"{len(segments)} segment(s), {kind} :")
    for g, seg in enumerate(segments):
        count = sum(c.group == g for c in analysis.target_cues)
        offset = f"{seg.offset_start:+.3f} s" if not seg.is_drift else f"{seg.offset_start:+.3f} -> {seg.offset_end:+.3f} s"
        warn = "  ⚠ peu fiable" if seg.confidence < LOW_CONFIDENCE else ""
        click.echo(
            f"  {_clock(seg.start_s)} -> {_clock(seg.end_s)}   {offset:<22} {count:4d} répliques   confiance {seg.confidence:.0%}{warn}"
        )
    orphans = sum(c.group == -1 for c in analysis.target_cues)
    if orphans:
        click.echo(f"{orphans} réplique(s) de la cible sans équivalent dans la référence (ou non dialoguées).")
    for warning in analysis.warnings:
        click.echo(f"⚠ {warning}")
    return analysis


CONSTANT_OPTION = click.option("--constant", is_flag=True, help="Un seul décalage pour toute la piste (ni dérive, ni sauts).")
TRACKS_HELP = """
    \b
    REFERENCE, TARGET : file.srt / file.ass, ou file.mkv@N (N = piste de sous-titres, depuis 0,
    voir `probe`). Sans @N, la référence est la piste la plus complète du MKV."""


@main.command(help="Mesure le décalage de TARGET par rapport à REFERENCE (dérive et sauts compris).\n" + TRACKS_HELP)
@click.argument("reference")
@click.argument("target")
@CONSTANT_OPTION
def align(reference: str, target: str, constant: bool) -> None:
    _run_analysis(reference, target, constant)


@main.command(
    help="""Recale TARGET sur REFERENCE et écrit le résultat.

    \b
    Par défaut, un nouveau MKV à côté de la référence (Film.synced.mkv) :
    - TARGET dans le même MKV : la piste corrigée remplace l'originale ;
    - TARGET externe (SRT/ASS) : elle est ajoutée au MKV.
    Le fichier d'origine n'est jamais modifié.
    """
    + TRACKS_HELP
)
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
    analysis = _run_analysis(reference, target, constant)
    try:
        written = write_result(
            analysis.reference, analysis.target, analysis.segments, output, subs_only, language, title, default
        )
    except (AnalysisError, FFmpegError) as exc:
        _fail(str(exc))
    if written.dropped:
        click.echo(f"{len(written.dropped)} réplique(s) retirée(s) (avant le début de la vidéo, ou dans une scène absente de la référence) :")
        for start, text in written.dropped:
            click.echo(f"  {_clock(start)}  {' / '.join(text.splitlines())[:70]}")
    if written.kind == "subtitles":
        click.echo(f"Écrit : {written.path}")
    else:
        action = "remplacée" if written.kind == "replaced" else "ajoutée"
        click.echo(f"Écrit : {written.path} (piste {action}, langue {written.language or 'non précisée'})")


@main.command()
@click.option("--host", default="127.0.0.1", show_default=True)
@click.option("--port", default=DEFAULT_PORT, show_default=True, type=int)
@click.option("--parent-pid", type=int, help="S'arrête dès que ce processus (l'application) disparaît.")
def serve(host: str, port: int, parent_pid: int | None) -> None:
    """Lance le serveur HTTP local utilisé par l'application (docs : /docs)."""
    import uvicorn

    from syncsubtitles.server import app

    if parent_pid is not None:
        from syncsubtitles.parent_watchdog import exit_when_parent_dies

        exit_when_parent_dies(parent_pid)
    # A packaged windowed exe has no stdout/stderr: uvicorn's logging
    # setup crashes on the None stream.
    if sys.stdout is None:
        sys.stdout = open(os.devnull, "w", encoding="utf-8")
    if sys.stderr is None:
        sys.stderr = open(os.devnull, "w", encoding="utf-8")
    click.echo(f"Bobine Subs sur http://{host}:{port} (docs : /docs)", err=True)
    # The app object, not "module:attr": the string form fails inside a
    # PyInstaller-frozen build.
    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    main()
