// The engine's retime.py, for an instant preview while segments are edited:
// the same choice of segment per cue and the same mapping, so what's shown
// is exactly what the export will write.
import type { Analysis, CueEdits, Segment } from "./api";

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

/** The segment of a cue at target time `t`, or inside a gap the one whose
 * span is the nearest (see retime.nearest_segment). */
function nearestSegment(t: number, segments: Segment[]): number {
  const i = segmentFor(t, segments);
  if (i !== null) return i;
  const distance = (s: Segment) => Math.max(targetStart(s) - t, t - targetEnd(s), 0);
  return segments.reduce((best, s, k) => (distance(s) < distance(segments[best]) ? k : best), 0);
}

/** A cue's (start, end) in reference time; null: dropped. `kept`: by hand,
 * through the nearest segment even in a gap (see retime.remap_cues). */
function remapCue(start: number, end: number, segments: Segment[], kept = false): [number, number] | null {
  const mid = (start + end) / 2;
  const i = kept && segments.length ? nearestSegment(mid, segments) : segmentFor(mid, segments);
  if (i === null) return null;
  const mapped: [number, number] = [toReference(segments[i], start), toReference(segments[i], end)];
  return mapped[1] <= 0 ? null : [Math.max(0, mapped[0]), mapped[1]];
}

export const NO_EDITS: CueEdits = { keep: [], drop: [] };

/** `analysis` with other segments and lines kept, taken out or timed by
 * hand (`edits`, its own by default): every corrected cue recomputed. A
 * line timed by hand keeps its times, wherever it is (unless taken out). */
export function withSegments(analysis: Analysis, segments: Segment[], edits: CueEdits = analysis.edits ?? NO_EDITS): Analysis {
  const keep = new Set(edits.keep);
  const drop = new Set(edits.drop);
  return {
    ...analysis,
    segments,
    edits,
    target_cues: analysis.target_cues.map((c, i) => ({
      ...c,
      corrected: drop.has(i) ? null : (edits.timing?.[i] ?? remapCue(c.start, c.end, segments, keep.has(i))),
    })),
  };
}

/** Why a line is left out of the export, or changed by hand: taken out by
 * hand, in a stretch the reference lacks, before the start; kept by hand,
 * its times set by hand. */
export type LineFate = "dropped" | "gap" | "start" | "kept" | "timed";

/** Left out of the export (not kept or timed by hand). */
export const isOut = (fate: LineFate | undefined) => fate === "dropped" || fate === "gap" || fate === "start";

/** The lines an export leaves out, and those kept or timed by hand, each
 * with why. */
export function lineFates(analysis: Analysis): { index: number; fate: LineFate }[] {
  const keep = new Set(analysis.edits?.keep ?? []);
  const drop = new Set(analysis.edits?.drop ?? []);
  const timing = analysis.edits?.timing ?? {};
  return analysis.target_cues.flatMap((c, index): { index: number; fate: LineFate }[] => {
    if (drop.has(index)) return [{ index, fate: "dropped" }];
    if (timing[index]) return [{ index, fate: "timed" }];
    if (c.corrected === null || c.corrected[1] <= 0) {
      const fate: LineFate = segmentFor((c.start + c.end) / 2, analysis.segments) === null ? "gap" : "start";
      return [{ index, fate }];
    }
    return keep.has(index) ? [{ index, fate: "kept" }] : [];
  });
}

/** The shortest a line timed by hand can be (s). */
export const MIN_LINE_S = 0.2;

/** `edits` with line `index` given `times` by hand (in reference time,
 * to the millisecond), or back to its segment's (null). */
export function timeLine(edits: CueEdits | undefined, index: number, times: [number, number] | null): CueEdits {
  const timing = { ...edits?.timing };
  delete timing[index];
  if (times) timing[index] = [Math.round(times[0] * 1000) / 1000, Math.round(times[1] * 1000) / 1000];
  return { keep: [], drop: [], ...edits, timing };
}

/** What an export sends of `edits` (RenderTrack keep, drop, clean_skip,
 * timing). */
export function renderEdits(edits: CueEdits | undefined) {
  return { keep: edits?.keep ?? [], drop: edits?.drop ?? [], clean_skip: edits?.skip ?? [], timing: edits?.timing ?? {} };
}

/** `edits` with line `index` kept (or no longer), or taken out (or put back). */
export function editLine(edits: CueEdits | undefined, index: number, change: "keep" | "drop" | "reset"): CueEdits {
  const keep = (edits?.keep ?? []).filter((i) => i !== index);
  const drop = (edits?.drop ?? []).filter((i) => i !== index);
  if (change === "keep") keep.push(index);
  if (change === "drop") drop.push(index);
  return { ...edits, keep, drop };
}

/** `edits` with the cleanup's fixes of `lines` refused (`refuse`), or applied. */
export function skipCleanup(edits: CueEdits | undefined, lines: number[], refuse: boolean): CueEdits {
  const skip = new Set(edits?.skip ?? []);
  for (const i of lines) {
    if (refuse) skip.add(i);
    else skip.delete(i);
  }
  return { keep: [], drop: [], ...edits, skip: [...skip].sort((a, b) => a - b) };
}
