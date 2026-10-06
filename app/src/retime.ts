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

/** The segment a cue at target time `t` belongs to (see retime.segment_for):
 * cut at the middle where two segments claim it, none in a gap. */
export function segmentFor(t: number, segments: Segment[]): number | null {
  if (!segments.length) return null;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (targetStart(seg) <= t && t <= targetEnd(seg)) {
      const next = segments[i + 1];
      if (next && targetStart(next) <= t) {
        const cut = (targetStart(next) + targetEnd(seg)) / 2;
        return t < cut ? i : i + 1;
      }
      return i;
    }
  }
  if (t < targetStart(segments[0])) return 0;
  if (t > targetEnd(segments[segments.length - 1])) return segments.length - 1;
  return null;
}

/** A cue's (start, end) in reference time; null: dropped. */
export function remapCue(start: number, end: number, segments: Segment[]): [number, number] | null {
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
