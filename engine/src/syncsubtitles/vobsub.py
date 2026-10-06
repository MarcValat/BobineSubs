"""Cue timing of a VobSub (DVD) subtitle stream.

Each packet starts at its timestamp; when it stops is written inside the
packet (SPU): a chain of control sequences, each ``date(u16) next(u16)``
then commands, the one holding command 0x02 (stop display) giving the stop
date in units of 1024/90000 s. Matroska block durations usually say the
same, but files written by ffmpeg leave them unset.
"""

from __future__ import annotations

import struct

from syncsubtitles.subformats import Cue

_DATE_UNIT_S = 1024 / 90_000
# Argument bytes after each SPU command.
_ARGS = {0x00: 0, 0x01: 0, 0x02: 0, 0x03: 2, 0x04: 2, 0x05: 6, 0x06: 4}
# Without a stop date or a known duration, a picture stays up until the
# next one, at most this long.
MAX_DURATION_S = 5.0
_MAX_STOP_DELAY_S = 60.0


def split_packets(data: bytes) -> list[bytes]:
    """Raw packets written back to back: each starts with its own size (u16)."""
    packets, pos = [], 0
    while pos + 2 <= len(data):
        (size,) = struct.unpack_from(">H", data, pos)
        if size < 4:
            break
        packets.append(data[pos : pos + size])
        pos += size
    return packets


def stop_delay(packet: bytes) -> float | None:
    """Seconds from the packet's start to its stop-display command, if any."""
    if len(packet) < 4:
        return None
    (offset,) = struct.unpack_from(">H", packet, 2)
    seen = set()
    while offset + 4 <= len(packet) and offset not in seen:
        seen.add(offset)
        date, following = struct.unpack_from(">HH", packet, offset)
        pos = offset + 4
        while pos < len(packet):
            command = packet[pos]
            pos += 1
            if command == 0x02:
                return date * _DATE_UNIT_S
            if command == 0xFF or command not in _ARGS:
                break
            pos += _ARGS[command]
        if following == offset:
            break
        offset = following
    return None


def vobsub_cues(starts: list[float], durations: list[float | None], packets: list[bytes]) -> list[Cue]:
    """``starts``/``durations`` from the container (duration None: unknown)."""
    cues = []
    for n, start in enumerate(starts):
        duration = durations[n]
        if duration is None and n < len(packets):
            duration = stop_delay(packets[n])
            # 0xFFFF (~745 s): "until replaced", as ffmpeg's encoder writes it.
            if duration is not None and duration > _MAX_STOP_DELAY_S:
                duration = None
        if duration is None:
            following = starts[n + 1] if n + 1 < len(starts) else start + MAX_DURATION_S
            duration = min(following - start, MAX_DURATION_S)
        if duration > 0:
            cues.append(Cue(start, start + duration, ""))
    return cues
