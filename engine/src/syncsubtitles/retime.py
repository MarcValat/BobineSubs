"""Map cues from the target's timeline to the reference's.

``Segment`` is syncaudio's per-segment affine model: within a segment,
``target_time = ref_time + offset_start + slope * (ref_time - start_s)``,
which covers a constant shift, a drift, and (segment after segment) jumps.
"""

from __future__ import annotations

from collections.abc import Collection, Sequence
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
    # The target-time stretch between the previous segment's cues and this
    # one's (cues inside it are dropped; a single time when they meet),
    # fixed once the boundary was edited by hand: moving a segment's offset
    # then keeps the cues each side of it. None: from the two spans (see
    # boundary_cut).
    target_cut: tuple[float, float] | None = None

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


def boundary_cut(prev: Segment, nxt: Segment) -> tuple[float, float]:
    """The target-time stretch between ``prev``'s cues and ``nxt``'s.

    - Fixed by hand (``nxt.target_cut``): that one.
    - The two target-time spans overlap (the target lacks content the
      reference has, so both segments claim the same stretch): cut at its
      middle.
    - A gap between them (the target has content the reference doesn't, a
      cut scene): the gap, nothing on screen matches what's in it.
    """
    if nxt.target_cut is not None:
        return nxt.target_cut
    if nxt.target_start <= prev.target_end:
        cut = (nxt.target_start + prev.target_end) / 2.0
        return cut, cut
    return prev.target_end, nxt.target_start


def segment_for(t: float, segments: Sequence[Segment]) -> Segment | None:
    """The segment a cue at target time ``t`` belongs to: the one between
    the boundaries around it (see boundary_cut), ``None`` inside a gap;
    before the first / after the last boundary: the first / last segment."""
    if not segments:
        return None
    for seg, nxt in zip(segments, segments[1:]):
        lo, hi = boundary_cut(seg, nxt)
        if t >= hi:
            continue
        return seg if t <= lo else None
    return segments[-1]


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


def nearest_segment(t: float, segments: Sequence[Segment]) -> Segment:
    """The segment a cue at target time ``t`` belongs to, or inside a gap
    the one whose target-time span is the nearest."""
    seg = segment_for(t, segments)
    if seg is not None:
        return seg
    return min(segments, key=lambda s: max(s.target_start - t, t - s.target_end, 0.0))


def remap_cues(
    document: SubtitleDocument,
    segments: Sequence[Segment],
    keep: Collection[int] = (),
    drop: Collection[int] = (),
) -> list[tuple[float, float] | None]:
    """Each cue's (start, end) in reference time, as remap_cue, or None:
    those by index in ``drop`` too (taken out by hand), and those in
    ``keep`` not, even in a gap (kept by hand: through the nearest segment)."""
    out: list[tuple[float, float] | None] = []
    for i, cue in enumerate(document.cues):
        mapped = None if i in drop else remap_cue(cue, segments)
        if mapped is None and i in keep and i not in drop and segments:
            seg = nearest_segment((cue.start + cue.end) / 2.0, segments)
            mapped = seg.to_reference(cue.start), seg.to_reference(cue.end)
        out.append(mapped)
    return out


def retime(
    document: SubtitleDocument,
    segments: Sequence[Segment],
    keep: Collection[int] = (),
    drop: Collection[int] = (),
) -> SubtitleDocument:
    """``document`` in reference time (see remap_cues: ``keep`` and ``drop``
    the lines kept or taken out by hand, by index)."""
    mapped = remap_cues(document, segments, keep, drop)
    index = {id(cue): i for i, cue in enumerate(document.cues)}
    return document.retimed(lambda cue: mapped[index[id(cue)]])
