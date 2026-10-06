"""Cue timing of a PGS (Blu-ray) subtitle stream, read straight from its segments.

No OCR needed: only *when* something is on screen matters for syncing, and
that's spelled out in the stream. A raw ``.sup`` stream is a sequence of
segments, each ``"PG" pts(u32, 90 kHz) dts(u32) type(u8) size(u16)``
followed by its payload. A display set starts with a Presentation
Composition Segment (PCS, type 0x16) whose object count says whether it
shows something (> 0) or clears the screen (0).
"""

from __future__ import annotations

import struct

from syncsubtitles.subformats import Cue

_HEADER = struct.Struct(">2sIIBH")
_PCS = 0x16
_CLOCK = 90_000
# A picture left up with no clear following it (end of stream).
_DEFAULT_DURATION_S = 3.0


def parse_sup(data: bytes) -> list[Cue]:
    cues: list[Cue] = []
    shown_at: float | None = None
    pos = 0
    while pos + _HEADER.size <= len(data):
        magic, pts, _dts, kind, size = _HEADER.unpack_from(data, pos)
        if magic != b"PG":
            raise ValueError(f"Not a PGS stream (bad segment header at byte {pos}).")
        payload = data[pos + _HEADER.size : pos + _HEADER.size + size]
        pos += _HEADER.size + size
        if kind != _PCS or len(payload) < 11:
            continue
        t = pts / _CLOCK
        objects = payload[10]
        # Whatever was shown ends here: cleared, or replaced by a new picture.
        if shown_at is not None and t > shown_at:
            cues.append(Cue(shown_at, t, ""))
        shown_at = t if objects > 0 else None
    if shown_at is not None:
        cues.append(Cue(shown_at, shown_at + _DEFAULT_DURATION_S, ""))
    return cues

