"""Read and write SRT and ASS/SSA subtitles, keeping everything but cue timing intact.

Retiming only touches cue start/end: an ASS file keeps its header, styles,
fonts and every untouched line verbatim, so a retimed file renders exactly
like the original, just at other times.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass, field, replace
from pathlib import Path

SRT = "srt"
ASS = "ass"

_CODEC_TO_FORMAT = {"subrip": SRT, "srt": SRT, "ass": ASS, "ssa": ASS}


def format_for_codec(codec: str) -> str | None:
    """The format a probed subtitle codec maps to, or ``None`` if it's not a
    text format this tool can retime (PGS, VobSub...)."""
    return _CODEC_TO_FORMAT.get(codec.strip().lower())


def format_for_path(path: str | Path, text: str | None = None) -> str:
    """Guess a standalone subtitle file's format from its extension, else its content."""
    suffix = Path(path).suffix.lower()
    if suffix == ".srt":
        return SRT
    if suffix in (".ass", ".ssa"):
        return ASS
    if text is not None and "[script info]" in text[:2000].lower():
        return ASS
    if text is not None and _SRT_TIMING.search(text):
        return SRT
    raise ValueError(f"Unrecognized subtitle format: {path}")


def decode_subtitle_bytes(data: bytes) -> str:
    """Decode a subtitle file of unknown encoding.

    Files from the web are often still Windows-1252 rather than UTF-8;
    anything that isn't valid UTF-8 (with or without BOM) or BOM-marked
    UTF-16 falls back to it.
    """
    if data.startswith((b"\xff\xfe", b"\xfe\xff")):
        return data.decode("utf-16")
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError:
        return data.decode("cp1252", errors="replace")


@dataclass(frozen=True)
class Cue:
    start: float
    end: float
    text: str
    # ASS style name, None for SRT.
    style: str | None = None


@dataclass
class SubtitleDocument:
    fmt: str
    cues: list[Cue]
    # ASS only: the original file's lines, and for each cue, which line it
    # came from with that line's parsed fields.
    _lines: list[str] = field(default_factory=list, repr=False)
    _events: list[_AssEvent] = field(default_factory=list, repr=False)

    def retimed(self, mapping: Callable[[float], float]) -> SubtitleDocument:
        """A copy with every cue's start/end passed through ``mapping``.

        Cues that end up entirely before 0 are dropped; one straddling 0 is
        cut to start at 0.
        """
        if self.fmt == SRT:
            cues = []
            for cue in self.cues:
                start, end = mapping(cue.start), mapping(cue.end)
                if end <= 0:
                    continue
                cues.append(Cue(max(start, 0.0), end, cue.text))
            return SubtitleDocument(SRT, cues)

        new_line_for: dict[int, str | None] = {}
        kept: list[tuple[Cue, _AssEvent]] = []
        for cue, event in zip(self.cues, self._events, strict=True):
            start, end = mapping(cue.start), mapping(cue.end)
            if end <= 0:
                new_line_for[event.line_index] = None
                continue
            start = max(start, 0.0)
            values = list(event.values)
            values[event.start_field] = _format_ass_time(start)
            values[event.end_field] = _format_ass_time(end)
            new_line_for[event.line_index] = f"{event.kind}: " + ",".join(values)
            kept.append((Cue(start, end, cue.text, cue.style), replace(event, values=tuple(values))))

        lines: list[str] = []
        moved_to: dict[int, int] = {}
        for i, line in enumerate(self._lines):
            new_line = new_line_for.get(i, line)
            if new_line is not None:
                moved_to[i] = len(lines)
                lines.append(new_line)
        cues = [cue for cue, _ in kept]
        events = [replace(event, line_index=moved_to[event.line_index]) for _, event in kept]
        return SubtitleDocument(ASS, cues, lines, events)

    def to_text(self) -> str:
        if self.fmt == SRT:
            blocks = [
                f"{n}\n{_format_srt_time(c.start)} --> {_format_srt_time(c.end)}\n{c.text}\n"
                for n, c in enumerate(sorted(self.cues, key=lambda c: c.start), start=1)
            ]
            return "\n".join(blocks)
        return "\n".join(self._lines) + "\n"


def parse(text: str, fmt: str) -> SubtitleDocument:
    if fmt == SRT:
        return _parse_srt(text)
    if fmt == ASS:
        return _parse_ass(text)
    raise ValueError(f"Unknown subtitle format: {fmt!r}")


def read_file(path: str | Path) -> SubtitleDocument:
    text = decode_subtitle_bytes(Path(path).read_bytes())
    return parse(text, format_for_path(path, text))


# --- SRT -------------------------------------------------------------------

_SRT_TIME = r"(\d+):(\d{1,2}):(\d{1,2})[,.](\d{1,3})"
_SRT_TIMING = re.compile(_SRT_TIME + r"\s*-->\s*" + _SRT_TIME)
_BLANK_LINES = re.compile(r"\n[ \t]*\n")


def _srt_seconds(h: str, m: str, s: str, frac: str) -> float:
    return int(h) * 3600 + int(m) * 60 + int(s) + int(frac) / 10 ** len(frac)


def _format_srt_time(t: float) -> str:
    total_ms = round(max(t, 0.0) * 1000)
    h, rem = divmod(total_ms, 3_600_000)
    m, rem = divmod(rem, 60_000)
    s, ms = divmod(rem, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _parse_srt(text: str) -> SubtitleDocument:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    cues: list[Cue] = []
    for block in _BLANK_LINES.split(text.strip()):
        lines = block.split("\n")
        timing_at = next((i for i, line in enumerate(lines) if _SRT_TIMING.search(line)), None)
        if timing_at is None:
            # A stray blank line inside a cue's text split it in two: the
            # rest still belongs to the previous cue.
            if cues and block.strip():
                prev = cues[-1]
                cues[-1] = Cue(prev.start, prev.end, prev.text + "\n" + block.strip("\n"))
            continue
        g = _SRT_TIMING.search(lines[timing_at]).groups()  # type: ignore[union-attr]
        start, end = _srt_seconds(*g[:4]), _srt_seconds(*g[4:])
        cues.append(Cue(start, end, "\n".join(lines[timing_at + 1 :]).strip("\n")))
    return SubtitleDocument(SRT, cues)


# --- ASS / SSA ---------------------------------------------------------------

_DEFAULT_ASS_FORMAT = ["Layer", "Start", "End", "Style", "Name", "MarginL", "MarginR", "MarginV", "Effect", "Text"]
_ASS_TIME = re.compile(r"^\s*(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)\s*$")


@dataclass(frozen=True)
class _AssEvent:
    line_index: int
    kind: str  # "Dialogue" only; comments are never retimed
    values: tuple[str, ...]
    start_field: int
    end_field: int


def _parse_ass_time(s: str) -> float:
    match = _ASS_TIME.match(s)
    if not match:
        raise ValueError(f"Invalid ASS timestamp: {s!r}")
    h, m, sec = match.groups()
    return int(h) * 3600 + int(m) * 60 + float(sec)


def _format_ass_time(t: float) -> str:
    total_cs = round(max(t, 0.0) * 100)
    h, rem = divmod(total_cs, 360_000)
    m, rem = divmod(rem, 6_000)
    s, cs = divmod(rem, 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def _parse_ass(text: str) -> SubtitleDocument:
    lines = text.replace("\r\n", "\n").replace("\r", "\n").rstrip("\n").split("\n")
    in_events = False
    fields = [f.lower() for f in _DEFAULT_ASS_FORMAT]
    cues: list[Cue] = []
    events: list[_AssEvent] = []
    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith("["):
            in_events = stripped.lower() == "[events]"
            continue
        if not in_events or ":" not in stripped:
            continue
        kind, _, rest = stripped.partition(":")
        kind = kind.strip()
        if kind.lower() == "format":
            fields = [f.strip().lower() for f in rest.split(",")]
            continue
        if kind != "Dialogue":
            continue
        values = tuple(rest.lstrip().split(",", len(fields) - 1))
        if len(values) != len(fields) or "start" not in fields or "end" not in fields:
            continue
        si, ei = fields.index("start"), fields.index("end")
        try:
            start, end = _parse_ass_time(values[si]), _parse_ass_time(values[ei])
        except ValueError:
            continue
        style = values[fields.index("style")].strip() if "style" in fields else None
        cues.append(Cue(start, end, values[-1], style))
        events.append(_AssEvent(i, kind, values, si, ei))
    return SubtitleDocument(ASS, cues, lines, events)
