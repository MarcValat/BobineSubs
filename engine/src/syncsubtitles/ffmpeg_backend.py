from __future__ import annotations

import re
import shutil
import subprocess
import sys
import tempfile
from functools import lru_cache
from pathlib import Path

from syncsubtitles.models import StreamInfo, SubtitleStreamInfo
from syncsubtitles.pgs import parse_sup
from syncsubtitles.vobsub import split_packets, vobsub_cues
from syncsubtitles.subformats import PGS, VOBSUB, Cue, SubtitleDocument, decode_subtitle_bytes, format_for_codec, parse

# Never flash a console window per ffmpeg call once packaged without a console.
_SUBPROCESS_FLAGS = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0


class FFmpegError(RuntimeError):
    """Raised when the ffmpeg binary is missing or a media operation fails."""


def _run(cmd: list[str]) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(cmd, capture_output=True, creationflags=_SUBPROCESS_FLAGS)


def run_checked(cmd: list[str]) -> bytes:
    proc = _run(cmd)
    if proc.returncode != 0:
        raise FFmpegError(f"ffmpeg failed:\n{' '.join(cmd)}\n{proc.stderr.decode(errors='replace')}")
    return proc.stdout


@lru_cache(maxsize=1)
def resolve_ffmpeg() -> str:
    """Locate an ffmpeg executable: prefer one on PATH, else the bundled one."""
    on_path = shutil.which("ffmpeg")
    if on_path:
        return on_path
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception as exc:  # pragma: no cover - defensive
        raise FFmpegError("ffmpeg not found: neither on PATH nor through the imageio-ffmpeg package.") from exc


def _file_identity(path: str) -> tuple[str, int, int]:
    st = Path(path).stat()
    return str(Path(path).resolve()), st.st_size, st.st_mtime_ns


@lru_cache(maxsize=32)
def _ffmpeg_info_cached(path: str, identity: tuple[str, int, int]) -> str:
    proc = _run([resolve_ffmpeg(), "-hide_banner", "-i", path])
    # UTF-8 explicitly: ffmpeg writes tags that way, cp1252 would mangle titles.
    return proc.stderr.decode("utf-8", errors="replace")


def ffmpeg_info(path: str) -> str:
    """``ffmpeg -i path``'s report, read once per unchanged file."""
    if not Path(path).is_file():
        raise FFmpegError(f"File not found: {path}")
    info = _ffmpeg_info_cached(path, _file_identity(path))
    if "Invalid data found" in info:
        raise FFmpegError(f"Cannot read {path!r}:\n{info}")
    return info


_STREAM_RE = re.compile(
    r"^\s*Stream #\d+:(?P<index>\d+)(?:\[[^\]]*\])?(?:\((?P<lang>[^)]+)\))?:\s*(?P<kind>\w+):\s*(?P<codec>[^,\s]+)?"
)
_TITLE_TAG_RE = re.compile(r"^\s+title\s*: (?P<title>.*)$")
_FORCED_TITLE_RE = re.compile(r"forc", re.IGNORECASE)
_START_RE = re.compile(r"Duration:\s*[^,]+,\s*start:\s*(?P<start>-?\d+(?:\.\d+)?)")
_DURATION_RE = re.compile(r"Duration:\s*(?P<h>\d+):(?P<m>\d+):(?P<s>\d+(?:\.\d+)?)")


def probe_streams(path: str) -> list[StreamInfo]:
    """Every stream of ``path``, in container order."""
    streams: list[dict] = []
    current: dict | None = None
    for line in ffmpeg_info(path).splitlines():
        if match := _STREAM_RE.match(line):
            current = {
                "index": int(match["index"]),
                "kind": match["kind"],
                "codec": match["codec"],
                "language": match["lang"] if match["lang"] not in (None, "und") else None,
                "title": None,
                "default": "(default)" in line,
                "forced": "(forced)" in line,
            }
            streams.append(current)
        elif current is not None and (title := _TITLE_TAG_RE.match(line)):
            if current["title"] is None:
                current["title"] = title["title"].strip()
        elif not line.startswith(" "):
            current = None
    return [StreamInfo(**s) for s in streams]


def probe_subtitle_streams(path: str) -> list[SubtitleStreamInfo]:
    """The subtitle streams of ``path``, indexed like ffmpeg's ``0:s:N``."""
    subs = [s for s in probe_streams(path) if s.kind == "Subtitle"]
    return [
        SubtitleStreamInfo(
            index=n,
            global_index=s.index,
            codec=s.codec or "?",
            language=s.language,
            title=s.title,
            forced=s.forced or bool(s.title and _FORCED_TITLE_RE.search(s.title)),
            default=s.default,
        )
        for n, s in enumerate(subs)
    ]


def probe_duration(path: str) -> float | None:
    match = _DURATION_RE.search(ffmpeg_info(path))
    if not match:
        return None
    return int(match["h"]) * 3600 + int(match["m"]) * 60 + float(match["s"])


def probe_start_time(path: str) -> float:
    """The container's start time: negative when a stream (typically AAC
    priming) starts before 0."""
    match = _START_RE.search(ffmpeg_info(path))
    return float(match["start"]) if match else 0.0


def remux_shift(path: str) -> float:
    """How much a plain ``ffmpeg -c copy`` remux of ``path`` moves its streams.

    ffmpeg offsets every input by minus its start time; a standalone SRT/ASS
    file has none, so a corrected track added next to the source isn't
    moved with it. Measured both ways: AAC priming (start -0.128 s) moved
    the video to 0.128 and left the new track 128 ms early; B-frames
    (HEVC, start +0.083 s) moved everything 83 ms back and left it 83 ms
    late. Feeding the new file through ``-itsoffset`` of this value keeps
    it in place against the video.
    """
    return -probe_start_time(path)


_IMAGE_FORMATS = {"hdmv_pgs_subtitle": PGS, "pgssub": PGS, "dvd_subtitle": VOBSUB, "dvdsub": VOBSUB}


def subtitle_format(codec: str) -> str | None:
    """``srt``/``ass`` (text, can be retimed), ``pgs``/``vobsub`` (image:
    timing only, usable as a reference), or None."""
    return format_for_codec(codec) or _IMAGE_FORMATS.get(codec.strip().lower())


def extract_subtitles(path: str, indices: list[int]) -> dict[int, SubtitleDocument]:
    """Read subtitle streams ``indices`` (``0:s:N``) of ``path``, all in one pass.

    One ffmpeg run reads the whole file whatever it extracts, which on a
    Blu-ray remux is most of the time spent: every track needed comes out
    of the same run. ``-copyts`` keeps the container's own timestamps:
    without it ffmpeg shifts the cues by the file's start time (+0.128 s on
    a file with AAC priming), away from the timeline they're muxed back
    into.
    """
    streams = probe_subtitle_streams(path)
    formats = {}
    for index in dict.fromkeys(indices):
        if index >= len(streams):
            raise FFmpegError(f"No subtitle track @{index} in {path!r} ({len(streams)} found).")
        fmt = subtitle_format(streams[index].codec)
        if fmt is None:
            raise FFmpegError(f"Subtitle track @{index} of {path!r} is {streams[index].codec}, which isn't supported.")
        formats[index] = fmt

    with tempfile.TemporaryDirectory(prefix="syncsubtitles-") as tmp:
        cmd = [resolve_ffmpeg(), "-hide_banner", "-loglevel", "error", "-y", "-copyts", "-i", path]
        outputs = {}
        for index, fmt in formats.items():
            if fmt == VOBSUB:
                # Packet timestamps (framecrc lists them) and raw packets
                # (each holds its own stop date).
                for muxer in ("framecrc", "data"):
                    cmd += ["-map", f"0:s:{index}", "-c:s", "copy", "-f", muxer, str(Path(tmp) / f"{index}.{muxer}")]
                continue
            muxer = "sup" if fmt == PGS else fmt
            outputs[index] = Path(tmp) / f"{index}.{muxer}"
            cmd += ["-map", f"0:s:{index}", "-c:s", "copy", "-f", muxer, str(outputs[index])]
        run_checked(cmd)

        docs = {}
        for index, fmt in formats.items():
            if fmt == VOBSUB:
                crc = (Path(tmp) / f"{index}.framecrc").read_text(encoding="ascii", errors="replace")
                starts, durations = _framecrc_timing(crc)
                packets = split_packets((Path(tmp) / f"{index}.data").read_bytes())
                docs[index] = SubtitleDocument(VOBSUB, vobsub_cues(starts, durations, packets))
                continue
            data = outputs[index].read_bytes()
            if fmt == PGS:
                docs[index] = SubtitleDocument(PGS, parse_sup(data))
            else:
                docs[index] = parse(decode_subtitle_bytes(data), fmt)
        return docs


def extract_subtitle(path: str, index: int) -> SubtitleDocument:
    return extract_subtitles(path, [index])[index]


_TIMEBASE_RE = re.compile(r"^#tb \d+: (?P<num>\d+)/(?P<den>\d+)", re.MULTILINE)
# Block durations above this are "unknown" (ffmpeg reports 2^32 - 1).
_MAX_KNOWN_DURATION_S = 60.0


def _framecrc_timing(text: str) -> tuple[list[float], list[float | None]]:
    """Packet starts and durations (None: unknown) from framecrc's list
    (``stream, dts, pts, duration, size, crc``)."""
    tb = _TIMEBASE_RE.search(text)
    unit = int(tb["num"]) / int(tb["den"]) if tb else 0.001
    starts, durations = [], []
    for line in text.splitlines():
        if line.startswith("#") or not line.strip():
            continue
        fields = [f.strip() for f in line.split(",")]
        duration = int(fields[3]) * unit
        starts.append(int(fields[2]) * unit)
        durations.append(duration if 0 < duration <= _MAX_KNOWN_DURATION_S else None)
    return starts, durations
