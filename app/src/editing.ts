// Hand edits of a segment list, as pure functions (the editor keeps an
// undo history of their results).
import type { Segment } from "./api";
import { LOW_CONFIDENCE } from "./shared";

/** A boundary never comes closer than this to its neighbours. */
export const MIN_SEGMENT_S = 1;
/** Offsets at a segment's two ends closer than this: a constant shift
 * (engine retime.DRIFT_EPS_S). */
export const DRIFT_EPS_S = 0.05;

export const isDrift = (s: Segment) => Math.abs(s.offset_end - s.offset_start) > DRIFT_EPS_S;

/** The offset of segment `s` at reference time `t` (on its line). */
export function offsetAt(s: Segment, t: number): number {
  const span = s.end_s - s.start_s;
  return span > 0 ? s.offset_start + ((s.offset_end - s.offset_start) * (t - s.start_s)) / span : s.offset_start;
}

/** Move the boundary between segments `i - 1` and `i` to `t`, each side
 * keeping its own line (a drift stays the same drift). */
export function moveBoundary(segments: Segment[], i: number, t: number): Segment[] {
  if (i <= 0 || i >= segments.length) return segments;
  const before = segments[i - 1];
  const after = segments[i];
  const clamped = Math.min(Math.max(t, before.start_s + MIN_SEGMENT_S), after.end_s - MIN_SEGMENT_S);
  const next = [...segments];
  next[i - 1] = { ...before, end_s: clamped, offset_end: offsetAt(before, clamped) };
  next[i] = { ...after, start_s: clamped, offset_start: offsetAt(after, clamped) };
  return next;
}

/** Shift segment `i`'s whole line by `delta` seconds. */
export function shiftOffset(segments: Segment[], i: number, delta: number): Segment[] {
  return segments.map((s, k) => (k === i ? { ...s, offset_start: s.offset_start + delta, offset_end: s.offset_end + delta } : s));
}

export function setOffsets(segments: Segment[], i: number, start: number, end: number): Segment[] {
  return segments.map((s, k) => (k === i ? { ...s, offset_start: start, offset_end: end } : s));
}

/** Cut the segment holding `t` in two, each half on the original line. */
export function split(segments: Segment[], t: number): Segment[] {
  const i = segments.findIndex((s) => s.start_s + MIN_SEGMENT_S <= t && t <= s.end_s - MIN_SEGMENT_S);
  if (i < 0) return segments;
  const s = segments[i];
  const middle = offsetAt(s, t);
  return [
    ...segments.slice(0, i),
    { ...s, end_s: t, offset_end: middle },
    { ...s, start_s: t, offset_start: middle },
    ...segments.slice(i + 1),
  ];
}

/** Remove segment `i` (a wrong detection): its neighbour (the next one, or
 * the previous for the last) stretches over its time with its own offset. */
export function remove(segments: Segment[], i: number): Segment[] {
  if (segments.length < 2) return segments;
  const j = i < segments.length - 1 ? i + 1 : i - 1;
  const gone = segments[i];
  const keep = segments[j];
  const merged: Segment = j > i ? { ...keep, start_s: gone.start_s, offset_start: keep.offset_start } : { ...keep, end_s: gone.end_s };
  // A drift's line extended over the freed time.
  if (isDrift(keep)) {
    if (j > i) merged.offset_start = offsetAt(keep, gone.start_s);
    else merged.offset_end = offsetAt(keep, gone.end_s);
  } else {
    merged.offset_start = merged.offset_end = keep.offset_start;
  }
  return segments.flatMap((s, k) => (k === i ? [] : k === j ? [merged] : [s]));
}

/** Remove every segment under LOW_CONFIDENCE, one at a time (each removal
 * shifts the others), until none is left or only one segment remains. */
export function removeUnreliable(segments: Segment[]): Segment[] {
  let current = segments;
  for (;;) {
    const i = current.findIndex((s) => s.confidence < LOW_CONFIDENCE);
    if (i < 0 || current.length < 2) return current;
    current = remove(current, i);
  }
}

/** Set segment `i`'s offset so that a target time `from` lands on reference
 * time `to` (the "align" tool: this line on that one). */
export function align(segments: Segment[], i: number, from: number, to: number): Segment[] {
  const s = segments[i];
  // Where `from` lands now; moving the line by the difference keeps its slope.
  const span = s.end_s - s.start_s;
  const slope = span > 0 ? (s.offset_end - s.offset_start) / span : 0;
  // target = ref + offset(ref)  =>  wanted: from = to + offset(to)
  const wanted = from - to;
  const current = s.offset_start + slope * (to - s.start_s);
  return shiftOffset(segments, i, wanted - current);
}

/** Undo history: `present` plus what came before and after. */
export interface History {
  past: Segment[][];
  present: Segment[];
  future: Segment[][];
}

const HISTORY_LIMIT = 200;

export const startHistory = (segments: Segment[]): History => ({ past: [], present: segments, future: [] });

export function commit(h: History, next: Segment[]): History {
  if (next === h.present) return h;
  return { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: next, future: [] };
}

export const undo = (h: History): History =>
  h.past.length ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] } : h;

export const redo = (h: History): History =>
  h.future.length ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h;
