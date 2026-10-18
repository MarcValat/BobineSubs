"""Just enough of Matroska's structure to check a written file's clusters.

Players read a Matroska file cluster by cluster, in file order: a cluster
whose blocks start earlier than the one before it holds blocks a player
like VLC considers already played, and skips (see render.check_cluster_order).
Only the element headers are read, each cluster's content skipped -- a
whole film is checked in a fraction of a second -- but where a cluster's
timestamp is earlier than the one before: its blocks and those of the one
before are read then, a cluster's timestamp being only where its blocks'
times count from (ffmpeg may give one a later timestamp than its first
blocks, written before it: they're not out of order).
"""

from __future__ import annotations

from pathlib import Path
from typing import BinaryIO

SEGMENT = 0x18538067
CLUSTER = 0x1F43B675
TIMESTAMP = 0xE7
SIMPLE_BLOCK = 0xA3
BLOCK_GROUP = 0xA0
BLOCK = 0xA1

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


def _clusters(f: BinaryIO, end_of_file: int) -> list[tuple[int, int, int]]:
    """Each cluster's timestamp, where its content starts and its size, in file order."""
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
    found: list[tuple[int, int, int]] = []
    pos = content
    while pos < end:
        element_id, content, size = _header(f, pos)
        if size is None:
            raise MatroskaError("unknown-size element: can't skip it")
        if element_id == CLUSTER:
            f.seek(content)
            found.append((_cluster_timestamp(f.read(_CLUSTER_HEAD)), content, size))
        pos = content + size
    return found


def cluster_timestamps(path: str | Path) -> list[int]:
    """Each cluster's timestamp (in the segment's timestamp unit), in file order."""
    path = Path(path)
    with path.open("rb") as f:
        return [ts for ts, _, _ in _clusters(f, path.stat().st_size)]


def _earliest_block(f: BinaryIO, timestamp: int, content: int, size: int) -> int:
    """When the cluster's earliest block plays: its timestamp plus the
    smallest of its blocks' relative times (signed); its timestamp without any."""
    f.seek(content)
    data = f.read(size)
    earliest = None
    pos = 0
    while pos < len(data):
        element_id, after_id, _ = _vint(data, pos, keep_marker=True)
        length, body, _ = _vint(data, after_id, keep_marker=False)
        block = None
        if element_id == SIMPLE_BLOCK:
            block = data[body : body + length]
        elif element_id == BLOCK_GROUP:
            inner = data[body : body + length]
            at = 0
            while at < len(inner):
                child, child_after, _ = _vint(inner, at, keep_marker=True)
                child_size, child_body, _ = _vint(inner, child_after, keep_marker=False)
                if child == BLOCK:
                    block = inner[child_body : child_body + child_size]
                    break
                at = child_body + child_size
        if block is not None:
            _, after_track, _ = _vint(block, 0, keep_marker=False)
            relative = int.from_bytes(block[after_track : after_track + 2], "big", signed=True)
            earliest = relative if earliest is None else min(earliest, relative)
        pos = body + length
    return timestamp if earliest is None else timestamp + earliest


def backward_clusters(path: str | Path) -> int:
    """How many clusters hold blocks that start before the previous
    cluster's: those a player would skip."""
    path = Path(path)
    with path.open("rb") as f:
        clusters = _clusters(f, path.stat().st_size)
        count = 0
        for before, after in zip(clusters, clusters[1:]):
            if after[0] < before[0] and _earliest_block(f, *after) < _earliest_block(f, *before):
                count += 1
        return count


def _cluster_timestamp(head: bytes) -> int:
    pos = 0
    while pos < len(head):
        element_id, after_id, _ = _vint(head, pos, keep_marker=True)
        size, content, _ = _vint(head, after_id, keep_marker=False)
        if element_id == TIMESTAMP:
            return int.from_bytes(head[content : content + size], "big")
        pos = content + size
    raise MatroskaError("cluster without a timestamp at its start")
