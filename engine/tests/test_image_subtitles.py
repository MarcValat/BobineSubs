from __future__ import annotations

import struct
import subprocess
from pathlib import Path

import pytest
from pgs_fixture import build_sup

from syncsubtitles.ffmpeg_backend import extract_subtitles, resolve_ffmpeg
from syncsubtitles.models import SubtitleTrackSpec
from syncsubtitles.pgs import parse_sup
from syncsubtitles.subformats import PGS, SRT, Cue, SubtitleDocument
from syncsubtitles.tracks import load_pair, parse_track_spec
from syncsubtitles.vobsub import split_packets, stop_delay, vobsub_cues

CUES = [Cue(10.0, 12.0, ""), Cue(20.0, 21.5, ""), Cue(21.5, 23.0, "")]


def _ff(*args: str) -> None:
    subprocess.run([resolve_ffmpeg(), "-hide_banner", "-loglevel", "error", "-y", *args], check=True)


def test_pgs_timing_is_read_from_its_segments():
    assert parse_sup(build_sup(CUES)) == CUES


def test_pgs_picture_never_cleared_gets_a_default_duration():
    sup = build_sup([Cue(5.0, 6.0, "")])
    # Drop the trailing clear display set (PCS + WDS + END segments).
    shown_only = sup[: sup.rfind(b"PG", 0, sup.rfind(b"PG", 0, sup.rfind(b"PG")))]
    assert parse_sup(shown_only) == [Cue(5.0, 8.0, "")]


@pytest.fixture
def bluray_like(tmp_path: Path) -> Path:
    """AAC audio (start -0.128 s), a forced SRT, a full PGS track, a French SRT."""
    (tmp_path / "vo.sup").write_bytes(build_sup(CUES))
    (tmp_path / "forced.srt").write_text("1\n00:00:20,000 --> 00:00:21,000\nSign\n")
    (tmp_path / "vf.srt").write_text("1\n00:00:11,000 --> 00:00:13,000\nUn\n")
    out = tmp_path / "bd.mkv"
    # -copyts: a .sup input would otherwise be moved to start at 0.
    _ff(
        "-copyts", "-f", "lavfi", "-i", "color=c=black:s=64x36:r=5:d=30", "-f", "lavfi", "-i", "anullsrc=r=8000:cl=mono",
        "-i", str(tmp_path / "forced.srt"), "-i", str(tmp_path / "vo.sup"), "-i", str(tmp_path / "vf.srt"),
        "-map", "0", "-map", "1", "-map", "2", "-map", "3", "-map", "4", "-t", "30",
        "-c:v", "mpeg4", "-c:a", "aac", "-c:s", "copy", "-disposition:s:0", "forced",
        str(out),
    )
    return out


def test_pgs_track_timing_survives_extraction(bluray_like: Path):
    docs = extract_subtitles(str(bluray_like), [1, 2])
    assert docs[1].fmt == PGS and docs[1].cues == CUES
    assert docs[2].fmt == SRT and docs[2].cues == [Cue(11.0, 13.0, "Un")]


def test_reference_defaults_to_the_fullest_non_forced_track(bluray_like: Path):
    pair = load_pair(parse_track_spec(str(bluray_like)), parse_track_spec(f"{bluray_like}@2"))
    assert pair.reference.stream_index == 1
    assert pair.reference_doc.cues == CUES
    assert pair.reference_choice is not None


def test_target_container_without_index_needs_one_when_ambiguous(bluray_like: Path):
    with pytest.raises(ValueError, match="@N"):
        load_pair(parse_track_spec(f"{bluray_like}@1"), SubtitleTrackSpec(str(bluray_like), str(bluray_like)))


def test_image_subtitles_cannot_be_retimed():
    with pytest.raises(ValueError):
        SubtitleDocument(PGS, CUES).retimed(lambda cue: (cue.start, cue.end))


def _spu(stop_units: int) -> bytes:
    """A DVD subtitle packet: 4 bytes of picture, then a start sequence and
    a stop sequence at date ``stop_units`` (1024/90000 s each)."""
    seq1_at = 4 + 4
    seq2_at = seq1_at + 6
    seq1 = struct.pack(">HH", 0, seq2_at) + bytes([0x01, 0xFF])
    seq2 = struct.pack(">HH", stop_units, seq2_at) + bytes([0x02, 0xFF])
    body = struct.pack(">H", seq1_at) + b"\0" * 4 + seq1 + seq2
    return struct.pack(">H", len(body) + 2) + body


def test_vobsub_stop_date_is_read_from_the_packet():
    packets = split_packets(_spu(176) + _spu(88))  # ~2.0 s, ~1.0 s
    assert len(packets) == 2
    assert stop_delay(packets[0]) == pytest.approx(2.0, abs=0.01)
    cues = vobsub_cues([10.0, 20.0], [None, None], packets)
    assert [(c.start, round(c.end, 2)) for c in cues] == [(10.0, 12.0), (20.0, 21.0)]


def test_vobsub_falls_back_to_block_duration_then_next_packet():
    packets = [_spu(0xFFFF), _spu(0xFFFF)]
    # Known container duration wins; an "until replaced" stop date
    # (0xFFFF) means: until the next packet, at most 5 s.
    assert vobsub_cues([10.0, 12.0], [1.5, None], packets) == [Cue(10.0, 11.5, ""), Cue(12.0, 17.0, "")]
