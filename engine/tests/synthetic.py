"""Synthetic subtitle tracks with realistic timing, for tests."""

from __future__ import annotations

import numpy as np

from syncsubtitles.subformats import Cue


def dialogue_cues(duration_s: float = 1200.0, seed: int = 0) -> list[Cue]:
    """Lines of 1-5 s separated by short pauses, with occasional long
    silences (scenes without dialogue)."""
    rng = np.random.default_rng(seed)
    cues, t = [], 5.0
    while t < duration_s:
        length = rng.uniform(1.0, 5.0)
        cues.append(Cue(round(t, 3), round(t + length, 3), f"line {len(cues)}"))
        gap = rng.exponential(1.5) + 0.1
        if rng.random() < 0.05:
            gap += rng.uniform(10, 40)
        t += length + gap
    return cues


def translated(cues: list[Cue], offset: float = 0.0, seed: int = 1) -> list[Cue]:
    """Another language's version of ``cues``, shifted by ``offset``: each
    edge jittered by up to 0.2 s, a few lines dropped or merged."""
    rng = np.random.default_rng(seed)
    out: list[Cue] = []
    for cue in cues:
        roll = rng.random()
        if roll < 0.03:
            continue
        start = cue.start + offset + rng.uniform(-0.2, 0.2)
        end = cue.end + offset + rng.uniform(-0.2, 0.2)
        if roll < 0.10 and out and start - out[-1].end < 1.0:
            out[-1] = Cue(out[-1].start, end, out[-1].text + " / " + cue.text)
            continue
        out.append(Cue(start, max(end, start + 0.5), cue.text))
    return out
