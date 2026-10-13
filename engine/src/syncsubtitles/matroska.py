"""Just enough of Matroska's structure to check a written file's clusters.

Players read a Matroska file cluster by cluster, in file order: a cluster
whose timestamp is earlier than the one before it holds blocks a player
like VLC considers already played, and skips (see render.check_cluster_order). Only the
element headers are read, each cluster's content skipped: a whole film is
checked in a fraction of a second.
"""

from __future__ import annotations

from pathlib import Path
from typing import BinaryIO

SEGMENT = 0x18538067
CLUSTER = 0x1F43B675
TIMESTAMP = 0xE7

# How much of a cluster's start is read to find its timestamp (it comes
# first, after an optional CRC-32).
_CLUSTER_HEAD = 64


class MatroskaError(ValueError):
    """Not a Matroska file this reader can walk (or a truncated one)."""


def _vint(data: bytes, pos: int, keep_marker: bool) -> tuple[int, int, bool]:
    """A variable-size integer at `pos`: its value, where it ends, and
    whether it's the "unknown size" value (all value bits set)."""
    if pos >= len(data):
        raise MatroskaError("truncated element")
    first = data[pos]
    if first == 0:
        raise MatroskaError("invalid variable-size integer")
    length = 9 - first.bit_length()
    if pos + length > len(data):
        raise MatroskaError("truncated element")
    value = first if keep_marker else first & (0xFF >> length)
    for b in data[pos + 1 : pos + length]:
        value = (value << 8) | b
    unknown = not keep_marker and value == (1 << (7 * length)) - 1
    return value, pos + length, unknown


def _header(f: BinaryIO, pos: int) -> tuple[int, int, int | None]:
    """The element at file offset `pos`: its id, where its content starts,
    and its size (None: unknown)."""
    f.seek(pos)
    head = f.read(12)
    element_id, after_id, _ = _vint(head, 0, keep_marker=True)
    size, after_size, unknown = _vint(head, after_id, keep_marker=False)
    return element_id, pos + after_size, None if unknown else size


def cluster_timestamps(path: str | Path) -> list[int]:
    """Each cluster's timestamp (in the segment's timestamp unit), in file order."""
    path = Path(path)
    end_of_file = path.stat().st_size
    with path.open("rb") as f:
        pos = 0
        while True:
            if pos >= end_of_file:
                raise MatroskaError("no segment")
            element_id, content, size = _header(f, pos)
            if element_id == SEGMENT:
                break
            if size is None:
                raise MatroskaError("unknown-size element before the segment")
            pos = content + size
        end = end_of_file if size is None else min(content + size, end_of_file)
        found: list[int] = []
        pos = content
        while pos < end:
            element_id, content, size = _header(f, pos)
            if element_id == CLUSTER:
                f.seek(content)
                head = f.read(_CLUSTER_HEAD)
                found.append(_cluster_timestamp(head))
            if size is None:
                raise MatroskaError("unknown-size element: can't skip it")
            pos = content + size
        return found


def _cluster_timestamp(head: bytes) -> int:
    pos = 0
    while pos < len(head):
        element_id, after_id, _ = _vint(head, pos, keep_marker=True)
        size, content, _ = _vint(head, after_id, keep_marker=False)
        if element_id == TIMESTAMP:
            return int.from_bytes(head[content : content + size], "big")
        pos = content + size
    raise MatroskaError("cluster without a timestamp at its start")


def out_of_order(timestamps: list[int]) -> int:
    """How many clusters start before the one written just before them."""
    return sum(1 for a, b in zip(timestamps, timestamps[1:]) if b < a)
