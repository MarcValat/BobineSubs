"""The end-to-end tests' media, synthetic: nothing copyrighted to provide.

Usage (from app/, the engine's environment has ffmpeg):
    uv run --project ../engine python e2e/make_media.py [out_dir]

Each file is built like a real release: a reference track (English) whose
lines follow a rhythm of their own, and a track to correct (French) with the
same lines -- a few dropped, a few merged, each one's edges a little off, as
a translation goes -- moved by a known offset, jump or drift: what the tests
expect the analysis to find (see MEDIA below and e2e/media.ts). Standalone
subtitle files for the pairs, named after their episode (or not). From Bobine
Audio's (its audio beds and voices here lines of subtitles). Deterministic
(seeded): the same files every time.

Rewritten only when this script changed (its hash in out_dir/stamp.txt).
"""

from __future__ import annotations

import hashlib
import random
import subprocess
import sys
import tempfile
from pathlib import Path

from syncsubtitles.ffmpeg_backend import resolve_ffmpeg

DURATION = 600.0
NTSC = 24000 / 1001

# Where a reference line at t lands in the track to correct: t + offset (a
# number: positive, it's late), or (time, offset) breakpoints (a jump), or
# ("drift", ratio, offset): t * ratio + offset.
MEDIA = {
    "Show - S01E01.mkv": {"seed": 1, "reference": "srt", "tracks": [("fre", "Français", 1.2)]},
    "Show - S01E02.mkv": {"seed": 2, "reference": "srt", "tracks": [("fre", "Français", [(0.0, 0.5), (300.0, 3.0)])]},
    # A PAL release: 23.976 fps played at 25, every line earlier and earlier.
    "Show - S01E03.mkv": {"seed": 3, "reference": "srt", "tracks": [("fre", "Français", ("drift", NTSC / 25, 0.3))]},
    # The reference as ASS, the track to correct early.
    "Show - S01E04.mkv": {"seed": 4, "reference": "ass", "tracks": [("fre", "Français", -0.8)]},
    # No episode number: paired by order.
    "Show - Bonus.mkv": {"seed": 5, "reference": "srt", "tracks": [("fre", "Français", 0.4)]},
    # Pairs: standalone subtitle files, against the same episode's video above.
    "show.s01e01.fr.srt": {"seed": 1, "pair_of": "Show - S01E01.mkv", "offset": 0.7},
    "show.s01e02.fr.srt": {"seed": 2, "pair_of": "Show - S01E02.mkv", "offset": 1.5},
    "bonus vf.srt": {"seed": 5, "pair_of": "Show - Bonus.mkv", "offset": 2.0},
}

ENGLISH = "the you to a it and that what is of in me this have know for no on be not we your go just".split()
FRENCH = "le la de un une et que tu je pas est ce en il on vous mais pour qui bien tout avec rien".split()


def rhythm(seed: int) -> list[tuple[float, float]]:
    """The reference's lines: when each starts and ends."""
    rng = random.Random(seed)
    cues = []
    t = rng.uniform(1.0, 3.0)
    while t < DURATION - 6:
        length = rng.uniform(0.8, 4.0)
        cues.append((round(t, 3), round(t + length, 3)))
        t += length + rng.uniform(0.2, 3.0)
    return cues


def line(rng: random.Random, words: list[str], n: int) -> str:
    text = " ".join(rng.choice(words) for _ in range(rng.randint(3, 9)))
    return f"{text.capitalize()} ({n})."


def moved(t: float, offset) -> float:
    if isinstance(offset, tuple):
        _, ratio, shift = offset
        return t * ratio + shift
    if isinstance(offset, list):
        return t + [off for start, off in offset if t >= start][-1]
    return t + offset


def translated(seed: int, offset) -> list[tuple[float, float, str]]:
    """The track to correct: the reference's lines in another language, a
    few dropped or merged, their edges a little off, then moved."""
    rng = random.Random(seed * 7919)
    cues = rhythm(seed)
    out = []
    i = 0
    while i < len(cues):
        start, end = cues[i]
        if rng.random() < 0.06:
            i += 1
            continue
        if i + 1 < len(cues) and rng.random() < 0.05:
            end = cues[i + 1][1]
            i += 1
        a = moved(start + rng.uniform(-0.04, 0.04), offset)
        b = moved(end + rng.uniform(-0.04, 0.04), offset)
        if a >= 0.05:
            out.append((round(a, 3), round(b, 3), line(rng, FRENCH, len(out) + 1)))
        i += 1
    # A jump forward: the stretch it adds (a scene the reference lacks) has a
    # line of its own, which the export leaves out unless kept by hand.
    if isinstance(offset, list):
        for (_, before), (at, after) in zip(offset, offset[1:]):
            if after > before + 1.0:
                out.append((round(at + before + 0.3, 3), round(at + after - 0.4, 3), "Une réplique que la référence n'a pas."))
        out.sort()
    return out


def reference_lines(seed: int) -> list[tuple[float, float, str]]:
    rng = random.Random(seed * 104729)
    return [(a, b, line(rng, ENGLISH, n + 1)) for n, (a, b) in enumerate(rhythm(seed))]


def write_subtitle(path: Path, cues: list[tuple[float, float, str]], kind: str) -> None:
    def ts(seconds: float, sep: str, digits: int) -> str:
        h, rem = divmod(seconds, 3600)
        m, s = divmod(rem, 60)
        frac = f"{s % 1:.{digits}f}"[2:]
        return f"{int(h):{'02' if sep == ',' else ''}d}:{int(m):02d}:{int(s):02d}{sep}{frac}"

    if kind == "srt":
        blocks = [f"{i + 1}\n{ts(a, ',', 3)} --> {ts(b, ',', 3)}\n{text}\n" for i, (a, b, text) in enumerate(cues)]
        path.write_text("\n".join(blocks), encoding="utf-8")
    else:
        events = "\n".join(f"Dialogue: 0,{ts(a, '.', 2)},{ts(b, '.', 2)},Default,,0,0,0,,{text}" for a, b, text in cues)
        path.write_text(
            "[Script Info]\nScriptType: v4.00+\n\n[V4+ Styles]\n"
            "Format: Name, Fontname, Fontsize, PrimaryColour, Bold, Italic, Alignment, MarginL, MarginR, MarginV\n"
            "Style: Default,Arial,20,&H00FFFFFF,0,0,2,10,10,10\n\n[Events]\n"
            "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n" + events + "\n",
            encoding="utf-8",
        )


def make(out_dir: Path, name: str, spec: dict, tmp: Path) -> None:
    seed = spec["seed"]
    if "pair_of" in spec:
        write_subtitle(out_dir / name, translated(seed, spec["offset"]), "srt")
        return
    kind = spec["reference"]
    tracks = [(tmp / f"{seed}-ref.{kind}", reference_lines(seed), kind, "eng", "English")]
    for i, (language, title, offset) in enumerate(spec["tracks"]):
        tracks.append((tmp / f"{seed}-{i}.srt", translated(seed, offset), "srt", language, title))
    inputs = ["-f", "lavfi", "-i", f"color=c=0x203048:s=160x90:r=1:d={DURATION}"]
    maps = ["-map", "0:v"]
    meta = ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "45", "-pix_fmt", "yuv420p"]
    for i, (path, cues, sub_kind, language, title) in enumerate(tracks):
        write_subtitle(path, cues, sub_kind)
        inputs += ["-i", str(path)]
        maps += ["-map", f"{i + 1}:s"]
        meta += [f"-c:s:{i}", sub_kind, f"-metadata:s:s:{i}", f"language={language}", f"-metadata:s:s:{i}", f"title={title}"]
    cmd = [resolve_ffmpeg(), "-v", "error", "-y", *inputs, *maps, *meta, "-t", str(DURATION), str(out_dir / name)]
    subprocess.run(cmd, check=True)


def main() -> None:
    out_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent / "media"
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    stamp_file = out_dir / "stamp.txt"
    if stamp_file.exists() and stamp_file.read_text() == stamp and all((out_dir / n).exists() for n in MEDIA):
        print(f"media up to date in {out_dir}")
        return
    with tempfile.TemporaryDirectory() as tmp:
        for name, spec in MEDIA.items():
            make(out_dir, name, spec, Path(tmp))
            print(f"made {name}")
    stamp_file.write_text(stamp)


if __name__ == "__main__":
    main()
