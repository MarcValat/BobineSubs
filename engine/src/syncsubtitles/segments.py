"""Find how the target's offset changes along the film: drift and jumps.

Subtitles are discrete events, which allows something more exact than
syncaudio's sliding windows: every target cue gets its own offset, picked
by a Viterbi pass over all cues at once.

1. Drift: a target made for another frame rate (PAL speed-up, 23.976 vs
   24...) runs at a constant speed ratio. The standard ratios close to the
   best whole-track correlation are each undone ("destretched") and run
   through the steps below; the best overall result wins.
2. Candidate offsets: sliding-window correlations give the offsets that
   occur somewhere in the film (long windows all along, short ones over
   the start, where a teaser and the opening credits often differ); only
   those (± a few seconds) are searched.
3. Viterbi: each cue scores each candidate offset by how well it lands on
   the reference's displayed cues, and its edges on theirs; changing
   offset between two cues costs ``JUMP_PENALTY``, plus
   ``BACK_JUMP_PER_S`` per second it goes back in the reference; a cue
   sharing a rare word with a reference cue (a name, mostly) also scores
   the offsets that put it there. A jump is
   only kept when several cues on its far side agree, and it always falls
   *between* two cues.
4. Each run of cues sharing an offset is a segment, its offset refined to
   the centre of its best plateau.
"""

from __future__ import annotations

import re
import unicodedata
from collections import defaultdict
from dataclasses import dataclass

import numpy as np

from syncsubtitles.activity import FRAME_RATE, activity_signal
from syncsubtitles.align import estimate_offset, offset_peaks
from syncsubtitles.filters import dialogue_indices, plain_text
from syncsubtitles.retime import Segment
from syncsubtitles.subformats import Cue, SubtitleDocument

# Frame-rate conversions a subtitle file is commonly off by (target speed
# over reference speed).
_NTSC = 24000 / 1001
STANDARD_RATIOS = (1.0, 25 / _NTSC, _NTSC / 25, 24 / _NTSC, _NTSC / 24, 25 / 24, 24 / 25)
# Ratios within this much whole-track correlation of the best one are
# tried in full.
_RATIO_CANDIDATE_MARGIN = 0.05

_WINDOW_S = 240.0
_HOP_S = 60.0
# How far a window looks for its match: covers a scene cut of a few minutes.
_WINDOW_SEARCH_S = 300.0
_WINDOW_MIN_SCORE = 0.2
# Short windows too, for a stretch shorter than a long window (a teaser
# before the opening credits, which a version may cut): each gives its few
# best offsets, ambiguous or not -- they're only candidates, the Viterbi
# picks.
_SHORT_WINDOW_S = 30.0
_SHORT_HOP_S = 15.0
_SHORT_PEAKS = 3
_SHORT_MIN_SCORE = 0.4
# Only over the start: where versions most often differ (a teaser, the
# opening credits); further on, their peaks are mostly chance fits.
_SHORT_SPAN_S = 360.0
# The windows are matched at FRAME_RATE / this.
_COARSE_DIVISOR = 10
# Candidate offsets: each window's estimate, plus or minus this, every
# _STATE_STEP_S.
_STATE_STEP_S = 0.05
_BAND_S = 2.0

# Cost of changing offset between two cues, in "cue scores" (a cue scores
# from -1, entirely over silence, to 1, entirely over reference cues).
# A cue can gain at most 2 by moving. Next to a real jump, giving one cue
# an offset of its own costs a single extra change, so anything up to 2
# lets lone cues wander off: seen on a real episode with 1.5, a line only
# the dub has ("Voilà.") moved 2.4 s onto another line. Above 2, it takes
# at least two cues agreeing.
JUMP_PENALTY = 2.5
# A change of offset that goes back in the reference (the target has a
# scene the reference doesn't) costs this much more per second: a run of
# lines landing by chance on a stretch the next ones need (dense dialogue
# fits almost any offset) is never worth it, a real scene is.
BACK_JUMP_PER_S = 0.3
# A cue also scores where its start and end fall: on a reference cue's
# start and end (within _EDGE_REACH_S), as two languages' lines break at
# the same places even where they're cut differently. In dense dialogue,
# where landing on reference cues tells offsets a few seconds apart
# hardly apart, that does. Its share of the score:
_EDGE_REACH_S = 1.0
_EDGE_WEIGHT = 0.2
# A word both languages write the same (a name, mostly: "Joe Namath",
# "Chilton"), in a target cue and a reference cue: the offsets that put
# the two within _NAME_REACH_S of each other score this much more. In dense
# dialogue, where landing on reference cues fits almost any offset (a
# "previously" put by chance on the first scene, its own lines then
# dropped), that tells the right one. A word in more reference cues than
# _NAME_MAX_REF tells nothing ("Lorelai").
_NAME_BONUS = 1.0
_NAME_REACH_S = 1.5
_NAME_MAX_REF = 8
_WORD = re.compile(r"[^\W\d_]{3,}")
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
    # Spoken target lines only (see filters).
    matches: list[CueMatch]


def _scaled(cues: list[Cue], ratio: float) -> list[Cue]:
    return cues if ratio == 1.0 else [Cue(c.start / ratio, c.end / ratio, c.text, c.style) for c in cues]


def ratio_candidates(reference: list[Cue], target: list[Cue]) -> list[float]:
    """Speed ratios worth a full detection: 1.0, and any whose whole-track
    correlation comes close to the best one's.

    Correlation alone can't settle it: a jump halfway through a track is
    explained about as well by a slight drift (seen: a 0.7 s jump over
    30 min read as 23.976 -> 24, 1.8 s over that time). The candidates are
    told apart by the full detection's result instead.
    """
    length = max(c.end for c in [*reference, *target]) * max(STANDARD_RATIOS) + 1.0
    ref = activity_signal(reference, length)
    scores = {}
    for ratio in STANDARD_RATIOS:
        tgt = activity_signal(_scaled(target, ratio), length)
        scores[ratio] = estimate_offset(ref, tgt, FRAME_RATE, max_offset_s=_WINDOW_SEARCH_S).score
    best = max(scores.values())
    return [1.0] + [r for r in STANDARD_RATIOS[1:] if scores[r] >= best - _RATIO_CANDIDATE_MARGIN]


def _coarse(x: np.ndarray) -> np.ndarray:
    """An activity signal at FRAME_RATE / _COARSE_DIVISOR: what the windows
    are matched at (their offsets only centre a band, see _BAND_S)."""
    d = _COARSE_DIVISOR
    return x[: len(x) // d * d].reshape(-1, d).mean(axis=1)


def window_offsets(ref: np.ndarray, tgt: np.ndarray) -> list[int]:
    """Offsets (frames) found by correlating successive reference windows
    against the target around them."""
    rate = FRAME_RATE / _COARSE_DIVISOR
    ref, tgt = _coarse(ref), _coarse(tgt)
    win, hop, search = (int(x * rate) for x in (_WINDOW_S, _HOP_S, _WINDOW_SEARCH_S))
    padded = np.concatenate([np.zeros(search), tgt, np.zeros(search + win)])
    found = []
    for w0 in range(0, max(1, len(ref) - win // 2), hop):
        ref_win = ref[w0 : w0 + win]
        if ref_win.sum() < 0.05 * len(ref_win):
            continue
        # padded[w0 : ...] starts `search` frames before w0 in target time.
        tgt_win = padded[w0 : w0 + len(ref_win) + 2 * search]
        est = estimate_offset(ref_win, tgt_win, rate, max_offset_s=2 * _WINDOW_SEARCH_S)
        if est.ambiguous or est.score < _WINDOW_MIN_SCORE:
            continue
        found.append(int(round((est.offset_seconds - _WINDOW_SEARCH_S) * FRAME_RATE)))
    return found


def short_window_offsets(ref: np.ndarray, tgt: np.ndarray) -> list[int]:
    """Offsets (frames) where short reference windows could land in the
    target, a few per window (see _SHORT_WINDOW_S)."""
    rate = FRAME_RATE / _COARSE_DIVISOR
    ref, tgt = _coarse(ref), _coarse(tgt)
    win, hop, search = (int(x * rate) for x in (_SHORT_WINDOW_S, _SHORT_HOP_S, _WINDOW_SEARCH_S))
    padded = np.concatenate([np.zeros(search), tgt, np.zeros(search + win)])
    found = []
    for w0 in range(0, max(1, min(len(ref), int(_SHORT_SPAN_S * rate)) - win // 2), hop):
        ref_win = ref[w0 : w0 + win]
        if ref_win.sum() < 0.05 * len(ref_win):
            continue
        tgt_win = padded[w0 : w0 + len(ref_win) + 2 * search]
        peaks = offset_peaks(ref_win, tgt_win, rate, 2 * _WINDOW_SEARCH_S, _SHORT_PEAKS, _SHORT_MIN_SCORE, _BAND_S)
        found += [int(round((p - _WINDOW_SEARCH_S) * FRAME_RATE)) for p in peaks]
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


@dataclass(frozen=True)
class _Reference:
    """The reference's cues as the scores read them, per frame: how many
    frames of cues up to there, and how far the nearest cue start and end."""

    cumsum: np.ndarray
    start_gap: np.ndarray
    end_gap: np.ndarray


def _gaps(points: np.ndarray, length: int) -> np.ndarray:
    """For each frame up to ``length``, how many frames to the nearest of ``points``."""
    points = np.sort(points)
    frames = np.arange(length)
    if len(points) == 1:
        return np.abs(frames - points[0])
    i = np.clip(np.searchsorted(points, frames), 1, len(points) - 1)
    return np.minimum(np.abs(frames - points[i - 1]), np.abs(points[i] - frames))


def _reference(cues: list[Cue], signal: np.ndarray) -> _Reference:
    edges = _cue_frames(cues)
    length = len(signal) + 1
    return _Reference(
        np.concatenate([[0.0], np.cumsum(signal)]), _gaps(edges[:, 0], length), _gaps(edges[:, 1], length)
    )


def _scores(ref: _Reference, frames: np.ndarray, offsets: np.ndarray) -> np.ndarray:
    durations = (frames[:, 1] - frames[:, 0])[:, None]
    overlap = (2 * _overlaps(ref.cumsum, frames, offsets) - durations) / durations
    last = len(ref.start_gap) - 1
    reach = _EDGE_REACH_S * FRAME_RATE
    starts = np.clip(frames[:, :1] - offsets[None, :], 0, last)
    ends = np.clip(frames[:, 1:] - offsets[None, :], 0, last)
    # In [-1, 1], as the overlap's: both edges on a reference edge, neither near one.
    edges = np.maximum(0, 1 - ref.start_gap[starts] / reach) + np.maximum(0, 1 - ref.end_gap[ends] / reach) - 1
    score = (1 - _EDGE_WEIGHT) * overlap + _EDGE_WEIGHT * edges
    # Before the video starts: neither silence nor speech to land on (a
    # "previously" only the target has). As silence, -1 each, it made a
    # whole recap cheaper to put by chance onto the dense first scene than
    # at its true offset, the first scene's own lines then dropped.
    return np.where(frames[:, 1:] - offsets[None, :] <= 0, 0.0, score).astype(np.float32)


def _fold(word: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", word) if not unicodedata.combining(c)).lower()


def _names(text: str) -> set[str]:
    """A target cue's words that may be names: capitalized, not starting a
    sentence (every word of an all-caps line)."""
    text = plain_text(text)
    caps = text.upper() == text
    names = set()
    for m in _WORD.finditer(text):
        before = text[: m.start()].rstrip(" \"'«»“”")
        if caps or (m.group()[0].isupper() and before and before[-1] not in ".!?-–—…:\n"):
            names.add(_fold(m.group()))
    return names


def _name_bonus(ref_cues: list[Cue], tgt_cues: list[Cue], states: np.ndarray) -> np.ndarray:
    """(cues, states) what each target cue scores more at each offset for a
    rare word it shares with a reference cue there (see _NAME_BONUS)."""
    where: dict[str, list[int]] = defaultdict(list)
    for r, cue in enumerate(ref_cues):
        for word in {_fold(w) for w in _WORD.findall(plain_text(cue.text))}:
            where[word].append(r)
    ref_frames = _cue_frames(ref_cues)
    frames = _cue_frames(tgt_cues)
    reach = _NAME_REACH_S * FRAME_RATE
    bonus = np.zeros((len(tgt_cues), len(states)), dtype=np.float32)
    for j, cue in enumerate(tgt_cues):
        for word in _names(cue.text):
            refs = where.get(word, ())
            if len(refs) > _NAME_MAX_REF:
                continue
            for r in refs:
                lo = np.searchsorted(states, frames[j, 0] - ref_frames[r, 1] - reach)
                hi = np.searchsorted(states, frames[j, 1] - ref_frames[r, 0] + reach, side="right")
                bonus[j, lo:hi] = _NAME_BONUS
    return bonus


def _running_argmax(x: np.ndarray) -> np.ndarray:
    """For each i, the index of the largest of x[0..i] (the first one)."""
    is_new = np.concatenate([[True], x[1:] > np.maximum.accumulate(x)[:-1]])
    return np.maximum.accumulate(np.where(is_new, np.arange(len(x)), 0))


def viterbi(
    scores: np.ndarray, states: np.ndarray, penalty: float = JUMP_PENALTY, back_per_s: float = BACK_JUMP_PER_S
) -> np.ndarray:
    """Best state per cue: maximizes the summed scores minus ``penalty`` per
    change, plus ``back_per_s`` per second a change goes back in the
    reference (to a higher offset, ``states`` ascending)."""
    n, k = scores.shape
    back = np.empty((n, k), dtype=np.int32)
    total = scores[0].astype(np.float64)
    stay = np.arange(k, dtype=np.int32)
    per_frame = back_per_s / FRAME_RATE
    positions = states.astype(np.float64)
    for i in range(1, n):
        # From a higher offset (forward in the reference): the penalty alone.
        forward = (k - 1 - _running_argmax(total[::-1]))[::-1]
        best, value = forward, total[forward] - penalty
        # From a lower one: also what it goes back, the best of
        # total + per_frame * position over the states below.
        lifted = total + per_frame * positions
        below = _running_argmax(lifted)
        backward = lifted[below] - per_frame * positions - penalty
        better = backward > value
        best, value = np.where(better, below, best), np.where(better, backward, value)
        keep = total >= value
        back[i] = np.where(keep, stay, best)
        total = np.where(keep, total, value) + scores[i]
    path = np.empty(n, dtype=np.int32)
    path[-1] = int(np.argmax(total))
    for i in range(n - 1, 0, -1):
        path[i - 1] = back[i, path[i]]
    return path


def _refine(ref: _Reference, frames: np.ndarray, around: int, reach_s: float = _REFINE_S) -> int:
    """The centre of the best plateau of a group's summed score near ``around``."""
    reach = int(reach_s * FRAME_RATE)
    offsets = np.arange(around - reach, around + reach + 1)
    total = _scores(ref, frames, offsets).sum(axis=0)
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
    ref_cues = [reference.cues[i] for i in dialogue_indices(reference.cues)]
    # Target cues by index into the document, spoken lines only, in time order.
    order = sorted(dialogue_indices(target.cues), key=lambda i: target.cues[i].start + target.cues[i].end)
    plain = [target.cues[i] for i in order]
    results = [_detect_at_ratio(ref_cues, plain, order, r) for r in ratio_candidates(ref_cues, plain)]
    # Ties go to the first candidate, 1.0 (no drift).
    return max(results, key=lambda result: result[1])[0]


def _detect_at_ratio(
    ref_cues: list[Cue], plain: list[Cue], order: list[int], ratio: float
) -> tuple[SegmentDetection, float]:
    """The detection once ``ratio`` is undone, and how good it is: every
    spoken line's score at its final offset, minus the jumps' cost (the
    Viterbi's own objective)."""
    tgt_cues = _scaled(plain, ratio)

    length = max(c.end for c in [*ref_cues, *tgt_cues]) + 1.0
    ref = activity_signal(ref_cues, length)
    tgt = activity_signal(tgt_cues, length)
    reference = _reference(ref_cues, ref)
    ref_cumsum = reference.cumsum

    centres = window_offsets(ref, tgt) + short_window_offsets(ref, tgt)
    centres.append(
        int(round(estimate_offset(ref, tgt, FRAME_RATE, max_offset_s=_WINDOW_SEARCH_S).offset_seconds * FRAME_RATE))
    )
    band = int(_BAND_S * FRAME_RATE)
    # Every _STATE_STEP_S: each run's offset is refined to the frame after.
    step = int(_STATE_STEP_S * FRAME_RATE)
    states = np.unique(np.concatenate([np.arange(c - c % step - band, c + band + 1, step) for c in centres]))

    frames = _cue_frames(tgt_cues)
    durations = frames[:, 1] - frames[:, 0]
    scores = _scores(reference, frames, states) + _name_bonus(ref_cues, tgt_cues, states)
    path = states[viterbi(scores, states)]

    # Runs of equal offset, each refined.
    breaks = np.flatnonzero(np.diff(path) != 0) + 1
    runs = [np.arange(a, b) for a, b in zip([0, *breaks], [*breaks, len(path)])]
    offsets = np.empty(len(path), dtype=np.int64)
    for run in runs:
        offsets[run] = _refine(reference, frames[run], int(path[run[0]]))

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
    # A rare word shared there too: of two runs fitting the same stretch
    # (a "previously" and the scene itself), the one saying its names.
    distinct, at = np.unique(offsets, return_inverse=True)
    named = _name_bonus(ref_cues, tgt_cues, distinct)[np.arange(len(offsets)), at] * durations
    kept = forward_chain(frames - offsets[:, None], run_ids, np.maximum(2 * overlap - durations, 0) + named + 1e-3)

    groups: list[tuple[np.ndarray, int]] = []
    for run in runs:
        members = run[kept[run]]
        if len(members) < _MIN_GROUP_CUES:
            kept[members] = False
            continue
        offset = _refine(reference, frames[members], int(offsets[members[0]]))
        if groups and groups[-1][1] == offset:
            groups[-1] = (np.concatenate([groups[-1][0], members]), offset)
        else:
            groups.append((members, offset))
    groups = _without_previously(groups, kept, reference, ref_cues, tgt_cues, frames)

    matches = [
        CueMatch(order[j], offsets[j] / FRAME_RATE, float(overlap[j] / durations[j]), -1) for j in range(len(path))
    ]
    for g, (members, offset) in enumerate(groups):
        for j in members:
            matches[j] = CueMatch(order[j], offset / FRAME_RATE, matches[j].overlap, g)
    matches.sort(key=lambda m: m.index)

    final = offsets.copy()
    for members, offset in groups:
        final[members] = offset
    objective = float(((2 * _cue_overlaps(ref_cumsum, frames, final) - durations) / durations).sum())
    objective -= JUMP_PENALTY * max(len(groups) - 1, 0)
    detection = SegmentDetection(_build_segments(groups, frames, kept, ref_cumsum, ratio, length), ratio, matches)
    return detection, objective


def _without_previously(
    groups: list[tuple[np.ndarray, int]],
    kept: np.ndarray,
    reference: _Reference,
    ref_cues: list[Cue],
    tgt_cues: list[Cue],
    frames: np.ndarray,
) -> list[tuple[np.ndarray, int]]:
    """``groups`` without a first one that is a "previously" only the
    target has, put by chance on the first scene (dense dialogue fits
    almost any offset): one the second group's offset would put entirely
    before the video starts. The cues from its first to the second group's
    then take the second's offset (those before the start are dropped
    anyway), when they score more there than it does at its own. A teaser
    of another offset (the video's opening credits the target lacks) is
    the other way round: never one. Weighed as the Viterbi does: the
    first group's cues, less going back in the reference to the second;
    the cues taking its place, at the offset that suits them best near the
    second's (a group of their own, or the second's). ``kept`` updated."""
    if len(groups) < 2:
        return groups
    (first, own), (second, then) = groups[0], groups[1]
    if np.any(frames[first, 1] - then > 0):
        return groups
    span = np.arange(first[0], second[0])

    def score(cues: np.ndarray, offsets: np.ndarray) -> np.ndarray:
        return (
            _scores(reference, frames[cues], offsets) + _name_bonus(ref_cues, [tgt_cues[j] for j in cues], offsets)
        )[:, 0]

    joining = span[frames[span, 1] - then > 0]
    if not len(joining):
        return groups
    near = _refine(reference, frames[joining], then, _BAND_S) if len(joining) >= _MIN_GROUP_CUES else then
    back = JUMP_PENALTY + BACK_JUMP_PER_S * (then - own) / FRAME_RATE
    if np.maximum(score(joining, np.array([near])), 0).sum() <= score(first, np.array([own])).sum() - back:
        return groups
    kept[first] = False
    kept[joining] = True
    if near != then:
        return [(joining, near), *groups[1:]]
    return [(np.concatenate([joining, second]), then), *groups[2:]]


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
