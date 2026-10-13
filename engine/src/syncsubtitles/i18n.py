"""Messages the user reads (job logs, errors), in the GUI's language.

A message is written in French, as a ``str.format`` template, and passed
through ``tr``: in French (the default, and the CLI's language) it comes
out as written; in English, its translation from ``_EN`` does. The GUI
sets the language (``POST /language``) at startup and whenever it changes.
A test checks that every template in the code has its translation. From
Bobine Audio.
"""

from __future__ import annotations

LANGUAGES = ("fr", "en")

_language = "fr"


def set_language(language: str) -> None:
    global _language
    if language not in LANGUAGES:
        raise ValueError(f"Unknown language: {language!r}")
    _language = language


def get_language() -> str:
    return _language


def tr(template: str, /, **values: object) -> str:
    """``template`` in the current language, filled with ``values``."""
    text = _EN.get(template, template) if _language == "en" else template
    return text.format(**values)


_EN: dict[str, str] = {
    # ffmpeg_backend
    "Échec ffmpeg :\n{command}\n{details}": "ffmpeg failed:\n{command}\n{details}",
    "ffmpeg introuvable : ni sur le PATH, ni via le paquet imageio-ffmpeg.": "ffmpeg not found: neither on the PATH nor through the imageio-ffmpeg package.",
    "Fichier introuvable : {path}": "File not found: {path}",
    "Impossible de lire {path!r} :\n{details}": "Can't read {path!r}:\n{details}",
    "Piste de sous-titres @{index} absente de {path!r} ({count} trouvée(s)).": "Subtitle track @{index} missing from {path!r} ({count} found).",
    "La piste de sous-titres @{index} de {path!r} est en {codec}, format non pris en charge.": "Subtitle track @{index} of {path!r} is {codec}, which isn't supported.",
    # tracks
    "{path} a {count} pistes de sous-titres texte : indique laquelle corriger avec {path}@N (voir `probe`).": "{path} has {count} text subtitle tracks: say which one to correct with {path}@N (see `probe`).",
    "La référence et la cible sont la même piste.": "The reference and the target are the same track.",
    "Aucune piste de sous-titres utilisable comme référence dans {path}.": "No usable reference subtitle track in {path}.",
    "@{index} ({codec}, {language}{title}, {count} répliques)": "@{index} ({codec}, {language}{title}, {count} lines)",
    "langue ?": "language ?",
    # subformats
    "Format de sous-titres non reconnu : {path}": "Unrecognized subtitle format: {path}",
    "Les sous-titres {fmt} sont des images : ils ne peuvent pas être recalés, seulement servir de référence.": "{fmt} subtitles are images: they can't be retimed, only used as a reference.",
    # render
    "Fichier écrit illisible : {error}": "Written file unreadable: {error}",
    "{count} groupe(s) de blocs hors de l'ordre du temps : certains lecteurs n'afficheraient pas tout": "{count} cluster(s) out of time order: some players wouldn't show everything",
    # server
    "Sous-titres illisibles : {error}": "Unreadable subtitles: {error}",
    "Aucun segment à appliquer.": "No segment to apply.",
    "Piste de référence non précisée.": "Reference track not given.",
    "Écrit : {path}": "Written: {path}",
    "Tâche inconnue : {job_id}": "Unknown job: {job_id}",
    # service
    "cible ralentie (25 -> 23,976 i/s)": "target slowed down (25 -> 23.976 fps)",
    "cible accélérée (23,976 -> 25 i/s, PAL)": "target sped up (23.976 -> 25 fps, PAL)",
    "cible ralentie (24 -> 23,976 i/s)": "target slowed down (24 -> 23.976 fps)",
    "cible accélérée (23,976 -> 24 i/s)": "target sped up (23.976 -> 24 fps)",
    "cible ralentie (25 -> 24 i/s)": "target slowed down (25 -> 24 fps)",
    "cible accélérée (24 -> 25 i/s)": "target sped up (24 -> 25 fps)",
    "rapport {ratio:.5f}": "ratio {ratio:.5f}",
    "Lecture des pistes de sous-titres…": "Reading the subtitle tracks…",
    "Référence choisie : {choice}": "Reference chosen: {choice}",
    "La cible est en {fmt} (sous-titres image) : seuls SRT et ASS peuvent être recalés.": "The target is {fmt} (image subtitles): only SRT and ASS can be retimed.",
    "Une des deux pistes ne contient aucune réplique.": "One of the two tracks has no lines.",
    "Référence : {reference} répliques, cible : {target} répliques": "Reference: {reference} lines, target: {target} lines",
    "La référence a bien moins de répliques que la cible : piste forcée ? Choisis-en une autre.": "The reference has far fewer lines than the target: a forced track? Pick another one.",
    "Recherche des décalages…": "Looking for the offsets…",
    "Résultat ambigu : un autre décalage correspond presque aussi bien.": "Ambiguous result: another offset fits almost as well.",
    "Certains segments sont peu fiables : vérifie-les.": "Some segments are unreliable: check them.",
    "{count} segment(s) trouvé(s)": "{count} segment(s) found",
    "Piste cible non précisée.": "Target track not given.",
    "Lecture de la piste à corriger…": "Reading the track to correct…",
    "La référence est un fichier de sous-titres seul : pas de MKV où ajouter la piste.": "The reference is a standalone subtitle file: no MKV to add the track to.",
    "Le fichier de sortie ne peut pas être un fichier d'origine.": "The output file can't be one of the original files.",
    "Écriture du MKV…": "Writing the MKV…",
}
