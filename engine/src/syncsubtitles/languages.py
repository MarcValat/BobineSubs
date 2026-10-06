from __future__ import annotations

import re
from pathlib import Path

# Filename tags that commonly mark a subtitle file's language, to ISO 639-2
# (what Matroska stores).
_TAGS = {
    "fr": "fre", "fre": "fre", "fra": "fre", "french": "fre", "francais": "fre", "français": "fre",
    "vf": "fre", "vff": "fre", "vfq": "fre", "vfi": "fre", "truefrench": "fre",
    "en": "eng", "eng": "eng", "english": "eng",
    "es": "spa", "spa": "spa", "spanish": "spa",
    "de": "ger", "ger": "ger", "deu": "ger", "german": "ger",
    "it": "ita", "ita": "ita", "italian": "ita",
    "pt": "por", "por": "por", "portuguese": "por",
    "ja": "jpn", "jpn": "jpn", "japanese": "jpn",
}


def guess_language(path: str | Path) -> str | None:
    """Language of a standalone subtitle file from its name (``Film.fr.srt``,
    ``episode-VF.srt``...), or None. The last matching word wins."""
    words = re.split(r"[^\wç]+", Path(path).stem.lower())
    for word in reversed(words):
        if word in _TAGS:
            return _TAGS[word]
    return None
