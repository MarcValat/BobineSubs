// The engine's retime.py, for an instant preview while segments are edited:
// the same choice of segment per cue and the same mapping, so what's shown
// is exactly what the export will write.
import type { Analysis, Segment } from "./api";

const targetStart = (s: Segment) => s.start_s + s.offset_start;
const targetEnd = (s: Segment) => s.end_s + s.offset_end;

/** A target time in reference time, through segment `s`'s affine map. */
function toReference(s: Segment, t: number): number {
  const duration = s.end_s - s.start_s;
  let factor = duration > 1e-9 ? (targetEnd(s) - targetStart(s)) / duration : 1;
  if (factor <= 0) factor = 1;
  return s.start_s + (t - targetStart(s)) / factor;
}

/** The target-time stretch between segment `k - 1`'s cues and segment
 * `k`'s (see retime.boundary_cut): fixed by hand (`target_cut`); else the
 * middle of the two spans' overlap, or the gap between them (a scene only
 * the target has: its cues are dropped). */
export function boundaryCut(segments: Segment[], k: number): [number, number] {
  const prev = segments[k - 1];
  const next = segments[k];
  if (next.target_cut) return next.target_cut;
  if (targetStart(next) <= targetEnd(prev)) {
    const cut = (targetStart(next) + targetEnd(prev)) / 2;
    return [cut, cut];
  }
  return [targetEnd(prev), targetStart(next)];
}

/** The segment a cue at target time `t` belongs to (see retime.segment_for):
 * the one between the boundaries around it, none inside a gap. */
export function segmentFor(t: number, segments: Segment[]): number | null {
  if (!segments.length) return null;
  for (let i = 0; i + 1 < segments.length; i++) {
    const [lo, hi] = boundaryCut(segments, i + 1);
    if (t >= hi) continue;
    return t <= lo ? i : null;
  }
  return segments.length - 1;
}

/** A cue's (start, end) in reference time; null: dropped. */
function remapCue(start: number, end: number, segments: Segment[]): [number, number] | null {
  const i = segmentFor((start + end) / 2, segments);
  if (i === null) return null;
  const mapped: [number, number] = [toReference(segments[i], start), toReference(segments[i], end)];
  return mapped[1] <= 0 ? null : [Math.max(0, mapped[0]), mapped[1]];
}

/** `analysis` with other segments: every corrected cue recomputed. */
export function withSegments(analysis: Analysis, segments: Segment[]): Analysis {
  return {
    ...analysis,
    segments,
    target_cues: analysis.target_cues.map((c) => ({ ...c, corrected: remapCue(c.start, c.end, segments) })),
  };
}
