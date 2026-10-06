"""Find how the target's offset changes along the film: drift and jumps.

Subtitles are discrete events, which allows something more exact than
syncaudio's sliding windows: every target cue gets its own offset, picked
by a Viterbi pass over all cues at once.

1. Drift: a target made for another frame rate (PAL speed-up, 23.976 vs
   24...) runs at a constant speed ratio. The standard ratios are tried on
   the whole track and the best one undone up front ("destretched").
2. Candidate offsets: sliding-window correlations give the offsets that
   occur somewhere in the film; only those (± a few seconds) are searched.
3. Viterbi: each cue scores each candidate offset by how well it lands on
   the reference's displayed cues; changing offset between two cues costs
   ``JUMP_PENALTY``. A jump is only kept when several cues on its far side
   agree, and it always falls *between* two cues.
4. Each run of cues sharing an offset is a segment, its offset refined to
   the centre of its best plateau.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from syncsubtitles.activity import FRAME_RATE, activity_signal
from syncsubtitles.align import estimate_offset
from syncsubtitles.retime import Segment
from syncsubtitles.subformats import Cue, SubtitleDocument

# Frame-rate conversions a subtitle file is commonly off by (target speed
# over reference speed).
_NTSC = 24000 / 1001
STANDARD_RATIOS = (1.0, 25 / _NTSC, _NTSC / 25, 24 / _NTSC, _NTSC / 24, 25 / 24, 24 / 25)
# A ratio other than 1 must beat it by this much correlation to be believed.
_RATIO_MIN_GAIN = 0.03

_WINDOW_S = 240.0
_HOP_S = 60.0
# How far a window looks for its match: covers a scene cut of a few minutes.
_WINDOW_SEARCH_S = 300.0
_WINDOW_MIN_SCORE = 0.2
# Candidate offsets: each window's estimate, plus or minus this.
_BAND_S = 2.0

# Cost of changing offset between two cues, in "cue scores" (a cue scores
# from -1, entirely over silence, to 1, entirely over reference cues).
# A cue can gain at most 2 by moving. Next to a real jump, giving one cue
# an offset of its own costs a single extra change, so anything up to 2
# lets lone cues wander off: seen on a real episode with 1.5, a line only
# the dub has ("Voilà.") moved 2.4 s onto another line. Above 2, it takes
# at least two cues agreeing.
JUMP_PENALTY = 2.5
# Cues of two different offsets may overlap this much in the reference:
# the two languages' timing differs, most visibly right at a jump (0.32 s
# on a real episode). Lines from a scene only the target has overlap
# reference lines by seconds.
_CHAIN_TOLERANCE_S = 0.5
# Fewer agreeing cues than this don't make a segment of their own.
_MIN_GROUP_CUES = 3
# The refined offset of a segment is searched this far around the
# Viterbi's own.
_REFINE_S = 0.5


@dataclass(frozen=True)
class CueMatch:
    """Where one target cue landed."""

    index: int  # in the target document
    offset: float  # seconds, in the destretched timeline
    overlap: float  # fraction of the cue over reference cues, in [0, 1]
    # Segment it belongs to, or -1: no counterpart in the reference
    # (a line only the target has, or one from a scene the video lacks).
    group: int


@dataclass(frozen=True)
class SegmentDetection:
    segments: list[Segment]
    # Target speed over reference speed (1.0: no drift).
    ratio: float
    matches: list[CueMatch]


def _scaled(cues: list[Cue], ratio: float) -> list[Cue]:
    return cues if ratio == 1.0 else [Cue(c.start / ratio, c.end / ratio, c.text, c.style) for c in cues]


def detect_ratio(reference: list[Cue], target: list[Cue]) -> float:
    """The standard speed ratio that best explains the target's timing."""
    length = max(c.end for c in [*reference, *target]) * max(STANDARD_RATIOS) + 1.0
    ref = activity_signal(reference, length)
    scores = {}
    for ratio in STANDARD_RATIOS:
        tgt = activity_signal(_scaled(target, ratio), length)
        scores[ratio] = estimate_offset(ref, tgt, FRAME_RATE, max_offset_s=_WINDOW_SEARCH_S).score
    best = max(scores, key=scores.__getitem__)
    return best if scores[best] - scores[1.0] >= _RATIO_MIN_GAIN else 1.0


def window_offsets(ref: np.ndarray, tgt: np.ndarray) -> list[int]:
    """Offsets (frames) found by correlating successive reference windows
    against the target around them."""
    win, hop, search = (int(x * FRAME_RATE) for x in (_WINDOW_S, _HOP_S, _WINDOW_SEARCH_S))
    padded = np.concatenate([np.zeros(search), tgt, np.zeros(search + win)])
    found = []
    for w0 in range(0, max(1, len(ref) - win // 2), hop):
        ref_win = ref[w0 : w0 + win]
        if ref_win.sum() < 0.05 * len(ref_win):
            continue
        # padded[w0 : ...] starts `search` frames before w0 in target time.
        tgt_win = padded[w0 : w0 + len(ref_win) + 2 * search]
        est = estimate_offset(ref_win, tgt_win, FRAME_RATE, max_offset_s=2 * _WINDOW_SEARCH_S)
        if est.ambiguous or est.score < _WINDOW_MIN_SCORE:
            continue
        found.append(int(round(est.offset_seconds * FRAME_RATE)) - search)
    return found


def _cue_frames(cues: list[Cue]) -> np.ndarray:
    frames = np.array([[c.start, c.end] for c in cues]) * FRAME_RATE
    frames = np.round(frames).astype(np.int64)
    frames[:, 1] = np.maximum(frames[:, 1], frames[:, 0] + 1)
    return frames


def _overlaps(ref_cumsum: np.ndarray, frames: np.ndarray, offsets: np.ndarray) -> np.ndarray:
    """(cues, offsets) frames of each cue over reference cues once shifted
    back by each offset."""
    last = len(ref_cumsum) - 1
    starts = np.clip(frames[:, :1] - offsets[None, :], 0, last)
    ends = np.clip(frames[:, 1:] - offsets[None, :], 0, last)
    return ref_cumsum[ends] - ref_cumsum[starts]


def _cue_overlaps(ref_cumsum: np.ndarray, frames: np.ndarray, offsets: np.ndarray) -> np.ndarray:
    """Frames of each cue over reference cues, each shifted by its own offset."""
    last = len(ref_cumsum) - 1
    starts = np.clip(frames[:, 0] - offsets, 0, last)
    ends = np.clip(frames[:, 1] - offsets, 0, last)
    return ref_cumsum[ends] - ref_cumsum[starts]


def _scores(ref_cumsum: np.ndarray, frames: np.ndarray, offsets: np.ndarray) -> np.ndarray:
    durations = (frames[:, 1] - frames[:, 0])[:, None]
    return ((2 * _overlaps(ref_cumsum, frames, offsets) - durations) / durations).astype(np.float32)


def viterbi(scores: np.ndarray, penalty: float = JUMP_PENALTY) -> np.ndarray:
    """Best state per cue: maximizes the summed scores minus ``penalty`` per change."""
    n, k = scores.shape
    back = np.empty((n, k), dtype=np.int32)
    total = scores[0].astype(np.float64)
    stay = np.arange(k, dtype=np.int32)
    for i in range(1, n):
        best = int(np.argmax(total))
        jump_value = total[best] - penalty
        keep = total >= jump_value
        back[i] = np.where(keep, stay, best)
        total = np.where(keep, total, jump_value) + scores[i]
    path = np.empty(n, dtype=np.int32)
    path[-1] = int(np.argmax(total))
    for i in range(n - 1, 0, -1):
        path[i - 1] = back[i, path[i]]
    return path


def _refine(ref_cumsum: np.ndarray, frames: np.ndarray, around: int) -> int:
    """The centre of the best plateau of a group's summed score near ``around``."""
    reach = int(_REFINE_S * FRAME_RATE)
    offsets = np.arange(around - reach, around + reach + 1)
    total = _scores(ref_cumsum, frames, offsets).sum(axis=0)
    best = np.flatnonzero(total >= total.max() - 1e-6)
    # The plateau around the maximum (several separate maxima: the first).
    run_end = best[0]
    while run_end + 1 in best:
        run_end += 1
    return int(offsets[(best[0] + run_end) // 2])


def forward_chain(ref_frames: np.ndarray, run_ids: np.ndarray, weights: np.ndarray) -> np.ndarray:
    """Mask of the heaviest set of cues that moves forward through the reference.

    Cues come in target order with their (start, end) in reference frames.
    Two successive kept cues of the same run (same offset) are always
    compatible: they keep the target's own order and overlaps. Across runs,
    the next one must start after the previous one ends (within
    ``_CHAIN_TOLERANCE_S``): no stretch of the reference is used twice.
    """
    n = len(weights)
    tolerance = _CHAIN_TOLERANCE_S * FRAME_RATE
    best = np.zeros(n)
    prev = np.full(n, -1, dtype=np.int64)
    for j in range(n):
        if j:
            ok = np.where(
                run_ids[:j] == run_ids[j],
                True,
                ref_frames[j, 0] >= ref_frames[:j, 1] - tolerance,
            )
            candidates = np.where(ok, best[:j], -np.inf)
            i = int(np.argmax(candidates))
            if candidates[i] > 0:
                best[j], prev[j] = candidates[i], i
        best[j] += weights[j]
    mask = np.zeros(n, dtype=bool)
    i = int(np.argmax(best)) if n else -1
    while i >= 0:
        mask[i] = True
        i = int(prev[i])
    return mask


def detect_segments(reference: SubtitleDocument, target: SubtitleDocument) -> SegmentDetection:
    if not reference.cues or not target.cues:
        raise ValueError("Both subtitle tracks must contain at least one cue.")
    ratio = detect_ratio(reference.cues, target.cues)
    order = sorted(range(len(target.cues)), key=lambda i: target.cues[i].start + target.cues[i].end)
    tgt_cues = _scaled([target.cues[i] for i in order], ratio)

    length = max(c.end for c in [*reference.cues, *tgt_cues]) + 1.0
    ref = activity_signal(reference.cues, length)
    tgt = activity_signal(tgt_cues, length)
    ref_cumsum = np.concatenate([[0.0], np.cumsum(ref)])

    centres = window_offsets(ref, tgt)
    centres.append(int(round(estimate_offset(ref, tgt, FRAME_RATE, max_offset_s=_WINDOW_SEARCH_S).offset_seconds * FRAME_RATE)))
    band = int(_BAND_S * FRAME_RATE)
    states = np.unique(np.concatenate([np.arange(c - band, c + band + 1) for c in centres]))

    frames = _cue_frames(tgt_cues)
    durations = frames[:, 1] - frames[:, 0]
    mids = frames.mean(axis=1)
    path = states[viterbi(_scores(ref_cumsum, frames, states))]

    # Runs of equal offset, each refined.
    breaks = np.flatnonzero(np.diff(path) != 0) + 1
    runs = [np.arange(a, b) for a, b in zip([0, *breaks], [*breaks, len(path)])]
    offsets = np.empty(len(path), dtype=np.int64)
    for run in runs:
        offsets[run] = _refine(ref_cumsum, frames[run], int(path[run[0]]))

    # The Viterbi alone may send a run of lines back onto a stretch of the
    # reference already used (a scene only the target has, its lines landing
    # on whatever fits): keep the heaviest set of cues moving forward in
    # the reference as they do in the target; the others have no
    # counterpart.
    overlap = _cue_overlaps(ref_cumsum, frames, offsets)
    run_ids = np.repeat(np.arange(len(runs)), [len(r) for r in runs])
    # Weighted like the Viterbi scores, in frames: what lands on reference
    # lines minus what spills over silence. Overlap alone let a long stray
    # line covering a short real one entirely (and a bit more) push it out.
    kept = forward_chain(frames - offsets[:, None], run_ids, np.maximum(2 * overlap - durations, 0) + 1e-3)

    groups: list[tuple[np.ndarray, int]] = []
    for run in runs:
        members = run[kept[run]]
        if len(members) < _MIN_GROUP_CUES:
            kept[members] = False
            continue
        offset = _refine(ref_cumsum, frames[members], int(offsets[members[0]]))
        if groups and groups[-1][1] == offset:
            groups[-1] = (np.concatenate([groups[-1][0], members]), offset)
        else:
            groups.append((members, offset))

    matches = [CueMatch(order[j], offsets[j] / FRAME_RATE, float(overlap[j] / durations[j]), -1) for j in range(len(path))]
    for g, (members, offset) in enumerate(groups):
        for j in members:
            matches[j] = CueMatch(order[j], offset / FRAME_RATE, matches[j].overlap, g)
    matches.sort(key=lambda m: m.index)

    return SegmentDetection(_build_segments(groups, frames, kept, ref_cumsum, ratio, length), ratio, matches)


def _build_segments(
    groups: list[tuple[np.ndarray, int]],
    frames: np.ndarray,
    kept: np.ndarray,
    ref_cumsum: np.ndarray,
    ratio: float,
    length: float,
) -> list[Segment]:
    """Segments in reference time from cue groups (destretched frames)."""
    mids = frames.mean(axis=1)
    cuts = [0.0]
    for (a, oa), (b, ob) in zip(groups, groups[1:]):
        # Boundary b (reference frames): A's last cue must stay in A's
        # target-time span (mid <= b + oa), B's first in B's (mid >= b + ob),
        # see retime.segment_for. The middle of that range by default.
        last_a, first_b = int(a[-1]), int(b[0])
        lo, hi = mids[last_a] - oa, mids[first_b] - ob
        cut = (lo + hi) / 2
        orphans = np.flatnonzero(~kept[last_a + 1 : first_b]) + last_a + 1
        if len(orphans) and lo <= hi:
            span = frames[orphans[-1], 1] - frames[orphans[0], 0]
            # A scene only the target has, as long as the jump: centre the
            # gap between the two spans (b + oa .. b + ob) on its lines, so
            # they're dropped. Lines that can't fit in it are real lines that
            # just didn't chain (timing jitter at the jump): kept.
            if span <= ob - oa + _CHAIN_TOLERANCE_S * FRAME_RATE:
                centre = (frames[orphans[0], 0] + frames[orphans[-1], 1]) / 2
                cut = float(np.clip(centre - (oa + ob) / 2, lo, hi))
        cuts.append(cut / FRAME_RATE)
    cuts.append(max(length, cuts[-1] + 1.0))

    segments = []
    for (members, offset), start, stop in zip(groups, cuts, cuts[1:]):
        o = offset / FRAME_RATE
        # Share of the group's displayed time landing on reference cues.
        overlap = _overlaps(ref_cumsum, frames[members], np.array([offset])).sum()
        confidence = float(overlap / (frames[members, 1] - frames[members, 0]).sum())
        # target = ratio * (ref + o)  =>  offset(ref) = (ratio - 1) * ref + ratio * o
        segments.append(
            Segment(
                float(start),
                float(stop),
                float((ratio - 1) * start + ratio * o),
                float((ratio - 1) * stop + ratio * o),
                confidence,
            )
        )
    return segments
