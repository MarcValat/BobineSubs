"""Which cues are spoken lines, the only ones worth syncing on.

Sound descriptions ("[music]", "(laughs)"), song lyrics, and in ASS signs,
karaoke and drawings are often only in one of the two languages' tracks,
or timed to the picture rather than the voices. They're left out of the
analysis, never out of the output: every cue is still retimed.
"""

from __future__ import annotations

import re
from collections.abc import Sequence

from syncsubtitles.subformats import Cue

_ASS_OVERRIDE = re.compile(r"\{[^}]*\}")
_HTML_TAG = re.compile(r"<[^>]*>")
# Whole-line sound descriptions and music marks.
_BRACKETED = re.compile(r"\[[^\]]*\]|\([^)]*\)|♪[^♪]*♪?|♫[^♫]*♫?|\*[^*]*\*")
_NOISE = re.compile(r"[\s\-–—.,:;!?…'\"♪♫#*]+")
_DRAWING = re.compile(r"\\p[1-9]")
_KARAOKE = re.compile(r"\\[kK][fo]?\d")
_NON_DIALOGUE_STYLE = re.compile(
    r"sign|song|kara|lyric|opening|ending|^(op|ed)(\b|[\s_\-\d])|title|insert|credit|logo|note|staff|screen",
    re.IGNORECASE,
)

# Below this share of cues left, filtering is more likely wrong than the
# track (e.g. a track entirely in a "Signs"-named style): use every cue.
_MIN_KEPT_SHARE = 0.5


def plain_text(text: str) -> str:
    text = _ASS_OVERRIDE.sub("", text)
    text = _HTML_TAG.sub("", text)
    return text.replace(r"\N", "\n").replace(r"\n", "\n").replace(r"\h", " ")


def is_dialogue(cue: Cue) -> bool:
    if _DRAWING.search(cue.text) or _KARAOKE.search(cue.text):
        return False
    if cue.style and _NON_DIALOGUE_STYLE.search(cue.style):
        return False
    if not cue.text:
        # Image subtitles: no text to judge.
        return True
    spoken = _NOISE.sub("", _BRACKETED.sub("", plain_text(cue.text)))
    return bool(spoken)


def dialogue_indices(cues: Sequence[Cue]) -> list[int]:
    """Indices of the cues to sync on (all of them if filtering would
    leave too few)."""
    kept = [i for i, cue in enumerate(cues) if is_dialogue(cue)]
    if len(kept) < _MIN_KEPT_SHARE * len(cues):
        return list(range(len(cues)))
    return kept
