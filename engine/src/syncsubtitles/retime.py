"""Map cues from the target's timeline to the reference's.

``Segment`` is syncaudio's per-segment affine model: within a segment,
``target_time = ref_time + offset_start + slope * (ref_time - start_s)``,
which covers a constant shift, a drift, and (segment after segment) jumps.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from syncsubtitles.subformats import Cue, SubtitleDocument

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

    @property
    def target_start(self) -> float:
        return self.start_s + self.offset_start

    @property
    def target_end(self) -> float:
        return self.end_s + self.offset_end

    def to_reference(self, t: float) -> float:
        """Invert the segment's affine map (target time -> reference time)."""
        duration = self.end_s - self.start_s
        factor = (self.target_end - self.target_start) / duration if duration > 1e-9 else 1.0
        if factor <= 0:
            factor = 1.0
        return self.start_s + (t - self.target_start) / factor


def constant_segments(offset: float, duration_s: float) -> list[Segment]:
    return [Segment(0.0, duration_s, offset, offset)]


def segment_for(t: float, segments: Sequence[Segment]) -> Segment | None:
    """The segment a cue at target time ``t`` belongs to.

    - Inside one segment's target-time span: that one.
    - Inside two consecutive spans (the target lacks content the
      reference has, so both segments claim the same target stretch): cut
      at the middle of the shared stretch.
    - Between two spans (the target has content the reference doesn't, a
      cut scene): ``None``, nothing on screen matches it.
    - Before the first / after the last span: the first / last segment.
    """
    if not segments:
        return None
    for i, seg in enumerate(segments):
        if seg.target_start <= t <= seg.target_end:
            nxt = segments[i + 1] if i + 1 < len(segments) else None
            if nxt is not None and nxt.target_start <= t:
                cut = (nxt.target_start + seg.target_end) / 2.0
                return seg if t < cut else nxt
            return seg
    if t < segments[0].target_start:
        return segments[0]
    if t > segments[-1].target_end:
        return segments[-1]
    return None


def remap_cue(cue: Cue, segments: Sequence[Segment]) -> tuple[float, float] | None:
    """A cue's (start, end) in reference time, both through the segment its
    middle belongs to (a cue is never split across a jump)."""
    if not segments:
        return cue.start, cue.end
    seg = segment_for((cue.start + cue.end) / 2.0, segments)
    if seg is None:
        return None
    return seg.to_reference(cue.start), seg.to_reference(cue.end)


def remap_time(t: float, segments: Sequence[Segment]) -> float:
    """A single target time in reference time (nearest segment if in a gap)."""
    seg = segment_for(t, segments)
    if seg is None:
        seg = max((s for s in segments if s.target_end < t), key=lambda s: s.target_end)
    return seg.to_reference(t)


def retime(document: SubtitleDocument, segments: Sequence[Segment]) -> SubtitleDocument:
    return document.retimed(lambda cue: remap_cue(cue, segments))
