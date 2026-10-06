"""Build a minimal but valid PGS (.sup) stream, for tests: ffmpeg can't
encode PGS, so test media can't get one any other way."""

from __future__ import annotations

import struct

from syncsubtitles.subformats import Cue


def _segment(pts: float, kind: int, payload: bytes) -> bytes:
    ticks = round(pts * 90_000)
    return struct.pack(">2sIIBH", b"PG", ticks, ticks, kind, len(payload)) + payload


def _display_set(pts: float, number: int, show: bool) -> bytes:
    width, height = 64, 36
    objects = struct.pack(">HBBHH", 0, 0, 0, 10, 10) if show else b""
    pcs = struct.pack(">HHBHBBBB", width, height, 0x10, number, 0x80 if show else 0x00, 0, 0, 1 if show else 0) + objects
    wds = struct.pack(">BBHHHH", 1, 0, 10, 10, 1, 1)
    out = _segment(pts, 0x16, pcs) + _segment(pts, 0x17, wds)
    if show:
        out += _segment(pts, 0x14, struct.pack(">BBBBBBB", 0, 0, 1, 235, 128, 128, 255))
        # One 1x1 picture: pixel of colour 1, then end of line.
        rle = bytes([0x01, 0x00, 0x00])
        data = struct.pack(">HH", 1, 1) + rle
        ods = struct.pack(">HBB", 0, 0, 0xC0) + len(data).to_bytes(3, "big") + data
        out += _segment(pts, 0x15, ods)
    return out + _segment(pts, 0x80, b"")


def build_sup(cues: list[Cue]) -> bytes:
    out = b""
    for n, cue in enumerate(cues):
        out += _display_set(cue.start, 2 * n, True) + _display_set(cue.end, 2 * n + 1, False)
    return out
