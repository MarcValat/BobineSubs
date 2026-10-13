"""Clusters written in time order (see render.mux, check_cluster_order).

ffmpeg's default max_interleave_delta stops waiting for a stream whose
packets lag: subtitles read from their own file then land in clusters out
of order, and VLC skips their blocks (found in Bobine Style on a real
episode). `-max_interleave_delta 0` makes it wait for all of them. A
synthetic file doesn't reproduce it (the trigger is in real sources'
structure), so the fix is pinned by the command itself, and every written
file whose clusters go backwards is refused. From Bobine Style.
"""

from __future__ import annotations

import struct
from pathlib import Path

import pytest
from test_mux import mkv  # noqa: F401 - fixture

import syncsubtitles.render as render_module
from syncsubtitles.ffmpeg_backend import FFmpegError
from syncsubtitles.matroska import CLUSTER, SEGMENT, TIMESTAMP, MatroskaError, cluster_timestamps, out_of_order
from syncsubtitles.render import TrackMetadata, check_cluster_order, mux
from syncsubtitles.subformats import SRT, Cue, SubtitleDocument

DOC = SubtitleDocument(SRT, [Cue(1.0, 2.0, "Un"), Cue(15.0, 16.0, "Deux")])


def test_mux_clusters_in_time_order(mkv: Path, tmp_path: Path):  # noqa: F811
    out = tmp_path / "out.mkv"
    mux(str(mkv), DOC, out, TrackMetadata(language="fre"))
    stamps = cluster_timestamps(out)
    assert len(stamps) > 1
    assert out_of_order(stamps) == 0


def test_mux_waits_for_every_stream(mkv: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):  # noqa: F811
    commands = []
    real = render_module.run_checked

    def spy(cmd):
        commands.append(cmd)
        return real(cmd)

    monkeypatch.setattr(render_module, "run_checked", spy)
    mux(str(mkv), DOC, tmp_path / "out.mkv", TrackMetadata(language="fre"))
    [cmd] = commands
    i = cmd.index("-max_interleave_delta")
    assert cmd[i + 1] == "0" and i < cmd.index("-f")


def _timestamp_offsets(path: Path) -> list[tuple[int, int]]:
    """(file offset, size) of each cluster's timestamp value."""
    data = path.read_bytes()

    def vint(pos: int, keep: bool) -> tuple[int, int]:
        length = 9 - data[pos].bit_length()
        value = data[pos] if keep else data[pos] & (0xFF >> length)
        for b in data[pos + 1 : pos + length]:
            value = (value << 8) | b
        return value, pos + length

    def children(start: int, end: int):
        pos = start
        while pos < end:
            element_id, pos = vint(pos, True)
            size, pos = vint(pos, False)
            yield element_id, pos, size
            pos += size

    _, start, size = next(e for e in children(0, len(data)) if e[0] == SEGMENT)
    found = []
    for element_id, pos, length in children(start, start + size):
        if element_id == CLUSTER:
            _, value, value_size = next(e for e in children(pos, pos + length) if e[0] == TIMESTAMP)
            found.append((value, value_size))
    return found


def test_a_file_with_clusters_out_of_order_is_refused(mkv: Path, tmp_path: Path):  # noqa: F811
    out = tmp_path / "out.mkv"
    mux(str(mkv), DOC, out, TrackMetadata(language="fre"))
    check_cluster_order(out)  # as written: fine
    offsets = _timestamp_offsets(out)
    assert len(offsets) >= 3
    # The third cluster said to start at 0: before the second one.
    pos, size = offsets[2]
    data = bytearray(out.read_bytes())
    data[pos : pos + size] = bytes(size)
    out.write_bytes(bytes(data))
    assert out_of_order(cluster_timestamps(out)) == 1
    with pytest.raises(FFmpegError, match="ordre du temps"):
        check_cluster_order(out)


def _element(element_id: int, payload: bytes, width: int) -> bytes:
    return element_id.to_bytes(width, "big") + bytes([0x80 | len(payload)]) + payload


def _cluster(ts: int, crc: bool = False) -> bytes:
    body = (_element(0xBF, b"\0\0\0\0", 1) if crc else b"") + _element(TIMESTAMP, bytes([ts]), 1)
    return _element(CLUSTER, body, 4)


def test_reader_skips_a_crc_and_reads_in_file_order(tmp_path: Path):
    path = tmp_path / "x.mkv"
    path.write_bytes(_element(0x1A45DFA3, b"", 4) + _element(SEGMENT, _cluster(5, crc=True) + _cluster(3), 4))
    assert cluster_timestamps(path) == [5, 3]
    assert out_of_order([5, 3]) == 1


def test_reader_unknown_size_segment(tmp_path: Path):
    """A live-written segment runs to the end of the file."""
    path = tmp_path / "x.mkv"
    body = _cluster(1) + _cluster(2)
    path.write_bytes(_element(0x1A45DFA3, b"", 4) + struct.pack(">I", SEGMENT) + b"\xff" + body)
    assert cluster_timestamps(path) == [1, 2]


def test_reader_rejects_what_it_cant_walk(tmp_path: Path):
    path = tmp_path / "x.mkv"
    path.write_bytes(b"not a matroska file")
    with pytest.raises(MatroskaError):
        cluster_timestamps(path)
