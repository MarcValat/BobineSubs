"""Map cue times from the target's timeline to the reference's.

``Segment`` and ``remap_time`` are syncaudio's, unchanged: the same
per-segment affine model covers a constant shift, a drift and jumps.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from syncsubtitles.subformats import SubtitleDocument

# Offsets at a segment's two ends closer than this are a constant shift.
DRIFT_EPS_S = 0.05


@dataclass(frozen=True)
class Segment:
    """One piece of the reference timeline with its own correction.

    ``offset_start``/``offset_end`` are the target's offset (positive = it
    lags) at the start/end of the segment, in reference time; different
    values mean a linear drift across it.
    """

    start_s: float
    end_s: float
    offset_start: float
    offset_end: float
    confidence: float = 1.0

    @property
    def is_drift(self) -> bool:
        return abs(self.offset_end - self.offset_start) > DRIFT_EPS_S

    @property
    def mean_offset(self) -> float:
        return (self.offset_start + self.offset_end) / 2.0


def constant_segments(offset: float, duration_s: float) -> list[Segment]:
    return [Segment(0.0, duration_s, offset, offset)]


def remap_time(t: float, segments: Sequence[Segment]) -> float:
    """Map a time of the target's ORIGINAL timeline to the reference timeline.

    Within a segment, ``target_time = ref_time + offset_start +
    slope * (ref_time - start_s)``; this inverts it. Times outside every
    segment's target-time span are shifted by the nearest segment's edge
    offset.
    """
    if not segments:
        return t
    for seg in segments:
        tgt_start = seg.start_s + seg.offset_start
        tgt_end = seg.end_s + seg.offset_end
        if tgt_start <= t <= tgt_end:
            duration = seg.end_s - seg.start_s
            factor = (tgt_end - tgt_start) / duration if duration > 1e-9 else 1.0
            if factor <= 0:
                factor = 1.0
            return seg.start_s + (t - tgt_start) / factor

    first, last = segments[0], segments[-1]
    if t < first.start_s + first.offset_start:
        return t - first.offset_start
    return t - last.offset_end


def retime(document: SubtitleDocument, segments: Sequence[Segment]) -> SubtitleDocument:
    return document.retimed(lambda t: remap_time(t, segments))
