"""Find the constant offset between two activity signals (FFT cross-correlation).

Taken from syncaudio's ``align.py`` (same sign convention, same peak
refinement and ambiguity check), on plain numpy FFTs.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

# Two peaks within this many seconds of each other are the same peak.
_SECONDARY_PEAK_MIN_DISTANCE_S = 1.0
_SECONDARY_PEAK_RATIO = 0.85


@dataclass(frozen=True)
class OffsetEstimate:
    # Positive: the target lags (its lines appear later than the reference's).
    offset_seconds: float
    # Correlation at the peak, in [-1, 1]: how much the two tracks' timing
    # agrees once shifted (1 = identical on/off pattern).
    score: float
    ambiguous: bool


def _standardize(x: np.ndarray) -> np.ndarray:
    std = x.std()
    if std < 1e-12:
        return np.zeros_like(x)
    return (x - x.mean()) / std


def estimate_offset(
    reference: np.ndarray,
    target: np.ndarray,
    frame_rate: float,
    max_offset_s: float | None = None,
) -> OffsetEstimate:
    """How much ``target`` is shifted against ``reference``.

    Lags are searched within ``max_offset_s`` (default: anything with the
    two signals still overlapping by half the shorter one).
    """
    lags, norm = _correlation(reference, target, frame_rate, max_offset_s)
    peak = int(np.argmax(norm))
    delta = _parabolic_refine(norm, peak)
    return OffsetEstimate(
        offset_seconds=(lags[peak] + delta) / frame_rate,
        score=float(norm[peak]),
        ambiguous=_has_competing_peak(norm, peak, frame_rate),
    )


def offset_peaks(
    reference: np.ndarray,
    target: np.ndarray,
    frame_rate: float,
    max_offset_s: float,
    count: int,
    min_score: float,
    min_distance_s: float,
) -> list[float]:
    """The ``count`` best offsets (seconds) of ``target`` against
    ``reference``, ``min_distance_s`` apart, each scoring at least
    ``min_score``: every place the two could line up, not just the best one
    (a short window often has several as good)."""
    lags, norm = _correlation(reference, target, frame_rate, max_offset_s)
    norm = norm.copy()
    reach = max(1, int(min_distance_s * frame_rate))
    found = []
    for _ in range(count):
        peak = int(np.argmax(norm))
        if not np.isfinite(norm[peak]) or norm[peak] < min_score:
            break
        found.append(float(lags[peak]) / frame_rate)
        norm[max(0, peak - reach) : peak + reach + 1] = -np.inf
    return found


def _correlation(
    reference: np.ndarray, target: np.ndarray, frame_rate: float, max_offset_s: float | None
) -> tuple[np.ndarray, np.ndarray]:
    """Every lag (frames, ascending) and the normalized correlation there;
    -inf where it isn't searched."""
    ref, tgt = _standardize(reference), _standardize(target)
    n_ref, n_tgt = len(ref), len(tgt)
    size = 1 << int(np.ceil(np.log2(n_ref + n_tgt - 1)))
    corr = np.fft.irfft(np.fft.rfft(tgt, size) * np.conj(np.fft.rfft(ref, size)), size)
    # corr[k] = sum tgt[i+k] * ref[i]; negative lags wrap around to the end.
    lags = np.concatenate([np.arange(0, n_tgt), np.arange(-(n_ref - 1), 0)])
    values = np.concatenate([corr[:n_tgt], corr[size - (n_ref - 1) :]])

    overlap = np.minimum(n_tgt - lags, n_ref) - np.maximum(0, -lags)
    norm = values / np.maximum(overlap, 1)
    allowed = overlap >= 0.5 * min(n_ref, n_tgt)
    if max_offset_s is not None:
        allowed &= np.abs(lags) <= max_offset_s * frame_rate
    norm = np.where(allowed, norm, -np.inf)

    order = np.argsort(lags)
    return lags[order], norm[order]


def _parabolic_refine(curve: np.ndarray, peak: int) -> float:
    if peak <= 0 or peak >= len(curve) - 1:
        return 0.0
    y0, y1, y2 = curve[peak - 1 : peak + 2]
    if not (np.isfinite(y0) and np.isfinite(y2)):
        return 0.0
    denom = y0 - 2 * y1 + y2
    if denom == 0:
        return 0.0
    return float(np.clip(0.5 * (y0 - y2) / denom, -1.0, 1.0))


def _has_competing_peak(curve: np.ndarray, peak: int, frame_rate: float) -> bool:
    value = curve[peak]
    if value <= 0:
        return True
    distance = max(1, int(_SECONDARY_PEAK_MIN_DISTANCE_S * frame_rate))
    far = np.concatenate([curve[: max(0, peak - distance)], curve[peak + distance + 1 :]])
    return bool(far.size and far.max() >= _SECONDARY_PEAK_RATIO * value)
