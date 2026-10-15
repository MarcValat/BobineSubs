"""Obvious faults of an SRT file, fixed as it's written corrected.

Only what can't be a choice of the file's author: spaces doubled or
stray, a dialogue dash stuck to its line, a sentence glued to the
previous one, a site's ad, lines overlapping or too short to be read.
French punctuation follows French rules (a no-break space before ? ! : ;),
other languages none, a track of unknown language as it is. The translator's credit stays. ASS files aren't
touched: their text holds its own tags, and overlapping lines (signs, two
speakers) are on purpose there.
"""

from __future__ import annotations

import re
from collections import Counter
from collections.abc import Collection, Sequence
from dataclasses import dataclass, replace

from syncsubtitles.subformats import SRT, Cue, SubtitleDocument

# A line shown less than this can't be read: lengthened, as far as the
# next one allows.
MIN_DURATION_S = 0.8
# Two lines overlapping by less than this aren't worth changing.
_OVERLAP_TOLERANCE_S = 0.04

_FRENCH = {"fre", "fra", "fr"}
# U+00A0, not the narrow U+202F French typography prefers: many players'
# fonts lack the narrow one (a box instead of a space).
_NBSP = " "

_TAG = re.compile(r"<[^>]*>|\{\\[^}]*\}")
_ADDRESS = re.compile(r"(?:https?://|www\.)\S+", re.IGNORECASE)
_DOMAIN = re.compile(r"^[\w.-]+\.(?:com|net|org|fr|tv|info|be|ca|eu)/?$", re.IGNORECASE)
_WORD = re.compile(r"\w+")
_SPACES = re.compile(r"[ \t]{2,}")
# "-Bonjour", "-...et puis" at a line's start: a dialogue dash.
_STUCK_DASH = re.compile(r"^([-–—])(?=[^\s\d-])")
# "juste ..." / "Bonjour ." / "bien ," -- not "... de Chilton" at a line's start.
_SPACE_BEFORE = re.compile(r"(?<=\S)[ \t" + _NBSP + r"]+(?=(?:\.\.\.|…|[.,])(?:\s|$|[^.\w]))")
# "aujourd'hui.Je", "école?Elle": two lowercase letters, then the next sentence.
_GLUED = re.compile(r"(?<=[a-zà-ÿ]{2})([.?!…]+)(?=[A-ZÀ-Ý])")
# Spaces before ? ! : ; (any kind), and the mark.
_BEFORE_MARK = re.compile(r"[ \t" + _NBSP + " ]*([?!:;]+)")
# No French space before ":" in a time or a ratio ("7:10").
_COLON_KEEP = re.compile(r"\d$")


@dataclass(frozen=True)
class Change:
    """What the cleanup does to one line: its index (in the target, as the
    analysis lists its lines), the kinds of fixes, its text before and
    after (None: taken out, a site's ad), how long it shows before and after."""

    index: int
    kinds: tuple[str, ...]
    before: str
    after: str | None
    duration_before: float
    duration_after: float


def clean(document: SubtitleDocument, language: str | None) -> tuple[SubtitleDocument, Counter[str]]:
    """``document`` with its obvious faults fixed (SRT only), and how many
    of each kind (keys: "spaces", "dashes", "glued", "punctuation",
    "apostrophes", "ads", "overlaps", "short", "inverted")."""
    cleaned, fixed, _ = review(document, language)
    return cleaned, fixed


def review(
    document: SubtitleDocument,
    language: str | None,
    skip: Collection[int] = (),
    indices: Sequence[int] | None = None,
) -> tuple[SubtitleDocument, Counter[str], list[Change]]:
    """As clean, line by line: each line's own fixes (see Change), the
    lines in ``skip`` left as they are (fixes refused by hand). Lines are
    known by ``indices`` (the target's line each of ``document``'s is: it
    may be a retimed copy, some lines dropped), else by their place."""
    fixed: Counter[str] = Counter()
    if document.fmt != SRT:
        return document, fixed, []
    # Unknown: the spaces before ? ! : ; stay as they are.
    french = None if not language else language.lower() in _FRENCH
    curly = _curly_apostrophes(document.cues)
    kinds: dict[int, Counter[str]] = {}
    originals: dict[int, Cue] = {}
    entries: list[tuple[int, Cue]] = []
    for k, cue in enumerate(document.cues):
        index = indices[k] if indices is not None else k
        originals[index] = cue
        if index in skip:
            entries.append((index, cue))
            continue
        own: Counter[str] = Counter()
        text = _clean_text(cue.text, french, curly, own)
        if text is None:
            own["ads"] += 1
        else:
            entries.append((index, replace(cue, text=text)))
        kinds[index] = own
    entries = _clean_timing(sorted(entries, key=lambda e: e[1].start), kinds, skip)
    kept = dict(entries)
    changes = []
    for index, own in kinds.items():
        if not +own:
            continue
        fixed.update(own)
        before, after = originals[index], kept.get(index)
        changes.append(
            Change(
                index,
                tuple(sorted(+own)),
                before.text,
                after.text if after is not None else None,
                round(before.end - before.start, 3),
                round(after.end - after.start, 3) if after is not None else 0.0,
            )
        )
    changes.sort(key=lambda c: c.index)
    return replace(document, cues=[cue for _, cue in entries]), +fixed, changes


def _curly_apostrophes(cues: list[Cue]) -> bool:
    """Whether the file mostly uses ’ rather than ' (the other gets aligned on it)."""
    text = "".join(c.text for c in cues)
    return text.count("’") > text.count("'")


def _clean_text(text: str, french: bool | None, curly: bool, fixed: Counter[str]) -> str | None:
    """A cue's text fixed, or None: nothing but a site's ad."""
    lines = []
    for line in text.split("\n"):
        if _is_ad(line):
            continue
        new = _SPACES.sub(" ", line.strip())
        if new != line:
            fixed["spaces"] += 1
        line, n = _STUCK_DASH.subn(r"\1 ", new)
        fixed["dashes"] += n
        line, n = _SPACE_BEFORE.subn("", line)
        fixed["spaces"] += n
        line, n = _GLUED.subn(r"\1 ", line)
        fixed["glued"] += n
        # A line naming an address keeps its "://".
        new = line if french is None or _ADDRESS.search(line) else _punctuation(line, french)
        if new != line:
            fixed["punctuation"] += 1
        line = new
        wrong, right = ("'", "’") if curly else ("’", "'")
        if wrong in line:
            fixed["apostrophes"] += line.count(wrong)
            line = line.replace(wrong, right)
        if line:
            lines.append(line)
    if not lines:
        # Only an ad: gone. A cue that was empty from the start stays as it was.
        return None if text.strip() else text
    return "\n".join(lines)


def _is_ad(line: str) -> bool:
    """A line that's a site's address, maybe with a word or two around it
    ("www.forom.com", "Visitez www.site.net"): not a line of dialogue
    naming one."""
    plain = _TAG.sub("", line).strip()
    if _DOMAIN.match(plain):
        return True
    return bool(_ADDRESS.search(plain)) and len(_WORD.findall(_ADDRESS.sub("", plain))) <= 3


def _punctuation(line: str, french: bool) -> str:
    """The spaces before ? ! : ; as the language wants them."""

    def fix(match: re.Match[str]) -> str:
        before = line[: match.start()]
        mark = match.group(1)
        # At a line's start ("?!"), or a time ("7:10"): as is.
        if not before.strip() or mark.startswith(":") and _COLON_KEEP.search(before):
            return match.group(0)
        return (_NBSP if french else "") + mark

    return _BEFORE_MARK.sub(fix, line)


def _clean_timing(
    entries: list[tuple[int, Cue]], kinds: dict[int, Counter[str]], skip: Collection[int]
) -> list[tuple[int, Cue]]:
    """Lines ending before they start, overlapping the next one, or too
    short to be read, fixed without ever covering the next line (those in
    ``skip`` left as they are); each line's fixes counted in ``kinds``."""
    out = list(entries)
    for i, (index, cue) in enumerate(out):
        if index in skip:
            continue
        fixed = kinds.setdefault(index, Counter())
        nxt = out[i + 1][1].start if i + 1 < len(out) else None
        start, end = cue.start, cue.end
        if end <= start:
            end = start + MIN_DURATION_S
            fixed["inverted"] += 1
        elif nxt is not None and end > nxt + _OVERLAP_TOLERANCE_S and nxt - start >= MIN_DURATION_S:
            end = nxt
            fixed["overlaps"] += 1
        elif end - start < MIN_DURATION_S:
            end = start + MIN_DURATION_S
            fixed["short"] += 1
        if nxt is not None and end > nxt and cue.end <= nxt + _OVERLAP_TOLERANCE_S:
            # Lengthened: only up to the next line.
            end = max(nxt, cue.end)
        if end != cue.end:
            out[i] = (index, replace(cue, end=end))
    return out
