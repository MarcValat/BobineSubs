"""Turn a subtitle track into a signal that can be correlated with another one.

What two subtitle tracks of the same video share, whatever their language,
is *when* lines are on screen: the same lines are spoken at the same
moments, with the same pauses between them. Each track becomes a 0/1 signal
("a cue is displayed") sampled at ``FRAME_RATE``, the subtitle counterpart
of syncaudio's audio envelope.
"""

from __future__ import annotations

from collections.abc import Sequence

import numpy as np

from syncsubtitles.subformats import Cue

# 10 ms: well below what anyone can see on a subtitle, and a 2-hour film is
# still only 720k samples.
FRAME_RATE = 100.0


def activity_signal(cues: Sequence[Cue], length_s: float | None = None) -> np.ndarray:
    """1.0 where at least one cue is displayed, 0.0 elsewhere, over ``[0, length_s)``."""
    end = max((c.end for c in cues), default=0.0)
    n = int(np.ceil((length_s if length_s is not None else end) * FRAME_RATE)) + 1
    # +1 at each start, -1 at each end, then a running sum: overlapping
    # cues (ASS signs, two speakers) count once.
    edges = np.zeros(n + 1, dtype=np.int32)
    for cue in cues:
        a = int(round(max(cue.start, 0.0) * FRAME_RATE))
        b = int(round(max(cue.end, 0.0) * FRAME_RATE))
        if b <= a or a >= n:
            continue
        edges[a] += 1
        edges[min(b, n)] -= 1
    return (np.cumsum(edges[:n]) > 0).astype(np.float64)
