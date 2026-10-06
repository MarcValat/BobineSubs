"""End-to-end: real MKV files through ffmpeg."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from syncsubtitles.ffmpeg_backend import extract_subtitle, probe_subtitle_streams, resolve_ffmpeg
from syncsubtitles.render import TrackMetadata, mux
from syncsubtitles.subformats import ASS, SRT, Cue, SubtitleDocument, parse

REF = "1\n00:00:10,000 --> 00:00:12,000\nHello\n\n2\n00:00:20,000 --> 00:00:21,500\nWorld\n"
VF = "1\n00:00:09,000 --> 00:00:11,000\nBonjour\n"


def _ff(*args: str) -> None:
    subprocess.run([resolve_ffmpeg(), "-hide_banner", "-loglevel", "error", "-y", *args], check=True)


def _first_pts_ms(path: Path, selector: str) -> int:
    out = subprocess.run(
        [
            resolve_ffmpeg(), "-hide_banner", "-loglevel", "error", "-copyts",
            "-i", str(path), "-map", selector, "-c", "copy", "-f", "framecrc", "-",
        ],
        capture_output=True, text=True, check=True,
    ).stdout
    return int(next(line for line in out.splitlines() if not line.startswith("#")).split(",")[2])


@pytest.fixture(params=["negative_start", "positive_start"])
def mkv(tmp_path: Path, request: pytest.FixtureRequest) -> Path:
    """Video + eng and fre subtitles, the file starting either below 0
    (AAC audio, whose priming starts at -0.128 s) or above it (video
    starting at 0.2 s, as B-frames make a real HEVC file start at 0.083)."""
    (tmp_path / "ref.srt").write_text(REF)
    (tmp_path / "vf.srt").write_text(VF)
    out = tmp_path / "in.mkv"
    subs = ["-i", str(tmp_path / "ref.srt"), "-i", str(tmp_path / "vf.srt")]
    tags = ["-metadata:s:s:0", "language=eng", "-metadata:s:s:1", "language=fre", "-metadata:s:s:1", "title=VF"]
    video = ["-f", "lavfi", "-i", "color=c=black:s=64x36:r=5:d=30"]
    if request.param == "negative_start":
        _ff(
            *video, "-f", "lavfi", "-i", "anullsrc=r=8000:cl=mono", *subs,
            "-map", "0", "-map", "1", "-map", "2", "-map", "3", "-t", "30",
            "-c:v", "mpeg4", "-c:a", "aac", "-c:s", "copy", *tags, str(out),
        )
    else:
        _ff(
            "-copyts", "-itsoffset", "0.25", *video, *subs,
            "-map", "0", "-map", "1", "-map", "2", "-t", "30", "-c:v", "mpeg4", "-c:s", "copy", *tags, str(out),
        )
    return out


def test_extraction_keeps_container_timestamps(mkv: Path):
    doc = extract_subtitle(str(mkv), 0)
    assert [(c.start, c.end) for c in doc.cues] == [(10.0, 12.0), (20.0, 21.5)]


def _subtitle_offset_from_video(path: Path, index: int) -> int:
    return _first_pts_ms(path, f"0:s:{index}") - _first_pts_ms(path, "0:v:0")


ASS_DOC = """[Script Info]
ScriptType: v4.00+

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:15.00,0:00:16.00,Default,,0,0,0,,Corrigé
"""


@pytest.mark.parametrize("fmt", [SRT, ASS])
@pytest.mark.parametrize("replace_index", [None, 1])
def test_muxed_track_lands_where_its_timestamps_say_against_the_video(mkv: Path, tmp_path: Path, replace_index, fmt):
    # A plain remux moves the whole file 0.128 s forward but not an added
    # subtitle file: the corrected track used to land 128 ms early.
    doc = SubtitleDocument(SRT, [Cue(15.0, 16.0, "Corrigé")]) if fmt == SRT else parse(ASS_DOC, ASS)
    out = tmp_path / "out.mkv"
    mux(str(mkv), doc, out, TrackMetadata(language="fre", title="VF"), replace_index)

    streams = probe_subtitle_streams(str(out))
    new_index = 1 if replace_index is not None else 2
    assert len(streams) == (2 if replace_index is not None else 3)
    assert (streams[new_index].language, streams[new_index].title) == ("fre", "VF")
    # The new cue is at 15 s on the source file's timeline, and every track
    # keeps its place against the video, whatever ffmpeg did to the file's
    # start. ASS is timed in centiseconds (15.128 s is written 15.13).
    video_start = _first_pts_ms(mkv, "0:v:0")
    assert _subtitle_offset_from_video(out, new_index) == pytest.approx(15000 - video_start, abs=10)
    assert _subtitle_offset_from_video(out, 0) == _subtitle_offset_from_video(mkv, 0)
