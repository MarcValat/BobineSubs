from __future__ import annotations

from dataclasses import dataclass

from syncsubtitles.activity import FRAME_RATE, activity_signal
from syncsubtitles.align import estimate_offset
from syncsubtitles.retime import Segment, constant_segments
from syncsubtitles.subformats import SubtitleDocument

# Beyond this, a "shift" is much more likely a mismatched track than a sync
# problem; it also keeps the search from locking onto a repeated pattern.
MAX_OFFSET_S = 600.0


@dataclass(frozen=True)
class Detection:
    segments: list[Segment]
    score: float
    ambiguous: bool


def detect_constant(reference: SubtitleDocument, target: SubtitleDocument) -> Detection:
    """One offset for the whole track."""
    if not reference.cues or not target.cues:
        raise ValueError("Both subtitle tracks must contain at least one cue.")
    length = max(c.end for c in [*reference.cues, *target.cues])
    estimate = estimate_offset(
        activity_signal(reference.cues, length),
        activity_signal(target.cues, length),
        FRAME_RATE,
        max_offset_s=MAX_OFFSET_S,
    )
    return Detection(constant_segments(estimate.offset_seconds, length), estimate.score, estimate.ambiguous)
