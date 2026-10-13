import { describe, expect, it } from "vitest";
import type { Segment } from "./api";
import {
  align,
  commit,
  isDrift,
  moveBoundary,
  offsetAt,
  redo,
  remove,
  removeUnreliable,
  shiftOffset,
  split,
  startHistory,
  undo,
} from "./editing";

const seg = (start_s: number, end_s: number, offset_start: number, offset_end: number, confidence = 0.9): Segment => ({
  start_s,
  end_s,
  offset_start,
  offset_end,
  confidence,
});

// A constant, an unreliable constant, then a drift (3 s to 4 s).
const segments = [seg(0, 100, 1, 1), seg(100, 200, 2, 2, 0.5), seg(200, 300, 3, 4, 0.95)];

describe("isDrift / offsetAt", () => {
  it("tells a drift from a constant by the engine's threshold", () => {
    expect(segments.map(isDrift)).toEqual([false, false, true]);
    expect(isDrift(seg(0, 100, 1, 1.04))).toBe(false);
  });

  it("reads a segment's offset on its line", () => {
    expect(offsetAt(segments[2], 250)).toBeCloseTo(3.5);
    expect(offsetAt(segments[0], 42)).toBe(1);
    expect(offsetAt(seg(10, 10, 2, 3), 10)).toBe(2);
  });
});

describe("moveBoundary", () => {
  it("keeps each side on its own line", () => {
    const moved = moveBoundary(segments, 2, 250);
    expect(moved[1]).toEqual(seg(100, 250, 2, 2, 0.5));
    expect(moved[2].start_s).toBe(250);
    expect(moved[2].offset_start).toBeCloseTo(3.5);
    expect(moved[2].offset_end).toBe(4);
  });

  it("stops a second away from the neighbours' far ends", () => {
    expect(moveBoundary(segments, 1, 500)[1].start_s).toBe(199);
    expect(moveBoundary(segments, 1, -5)[0].end_s).toBe(1);
  });

  it("leaves the outer edges alone", () => {
    expect(moveBoundary(segments, 0, 50)).toBe(segments);
    expect(moveBoundary(segments, 3, 50)).toBe(segments);
  });
});

describe("shiftOffset", () => {
  it("moves one segment's whole line", () => {
    const shifted = shiftOffset(segments, 2, 0.5);
    expect(shifted[2]).toEqual(seg(200, 300, 3.5, 4.5, 0.95));
    expect(shifted[0]).toBe(segments[0]);
  });
});

describe("split", () => {
  it("cuts a segment in two on its line", () => {
    const cut = split(segments, 250);
    expect(cut).toHaveLength(4);
    expect(cut[2]).toEqual(seg(200, 250, 3, 3.5, 0.95));
    expect(cut[3]).toEqual(seg(250, 300, 3.5, 4, 0.95));
  });

  it("refuses a cut too close to a boundary", () => {
    expect(split(segments, 200.5)).toBe(segments);
  });
});

describe("remove", () => {
  it("lets the next segment cover a removed one, a drift extended on its line", () => {
    expect(remove(segments, 1)).toEqual([segments[0], seg(100, 300, 2, 4, 0.95)]);
  });

  it("lets the next segment cover the first one, a constant keeping its offset", () => {
    expect(remove(segments, 0)).toEqual([seg(0, 200, 2, 2, 0.5), segments[2]]);
  });

  it("lets the previous segment cover the last one", () => {
    expect(remove(segments, 2)).toEqual([segments[0], seg(100, 300, 2, 2, 0.5)]);
    expect(remove([seg(0, 100, 1, 1.5), seg(100, 200, 2, 2)], 1)).toEqual([seg(0, 200, 1, 2)]);
  });

  it("never removes the only segment", () => {
    const one = [segments[0]];
    expect(remove(one, 0)).toBe(one);
  });
});

describe("removeUnreliable", () => {
  it("removes the segments under the confidence threshold", () => {
    expect(removeUnreliable(segments)).toEqual([segments[0], seg(100, 300, 2, 4, 0.95)]);
  });

  it("keeps one segment when none is reliable", () => {
    expect(removeUnreliable([seg(0, 100, 1, 1, 0.1), seg(100, 200, 2, 2, 0.1)])).toEqual([seg(0, 200, 2, 2, 0.1)]);
  });
});

describe("align", () => {
  it("puts a target time onto a reference time", () => {
    expect(align(segments, 0, 55, 50)[0]).toEqual(seg(0, 100, 5, 5));
  });

  it("keeps a drift's slope", () => {
    const aligned = align(segments, 2, 260, 250)[2];
    expect(aligned.offset_end - aligned.offset_start).toBeCloseTo(1);
    expect(250 + offsetAt(aligned, 250)).toBeCloseTo(260);
  });
});

describe("history", () => {
  it("undoes and redoes", () => {
    const a = startHistory(segments);
    const b = commit(a, remove(segments, 1));
    expect(undo(b).present).toBe(segments);
    expect(redo(undo(b)).present).toBe(b.present);
  });

  it("ignores an edit that changed nothing, and an undo or redo with nothing left", () => {
    const h = startHistory(segments);
    expect(commit(h, segments)).toBe(h);
    expect(undo(h)).toBe(h);
    expect(redo(h)).toBe(h);
  });

  it("forgets what was undone once something else is edited", () => {
    const h = commit(undo(commit(startHistory(segments), split(segments, 50))), shiftOffset(segments, 0, 1));
    expect(h.future).toEqual([]);
    expect(h.past).toEqual([segments]);
  });

  it("keeps the last 200 steps", () => {
    let h = startHistory(segments);
    for (let i = 0; i < 205; i++) h = commit(h, shiftOffset(h.present, 0, 0.1));
    expect(h.past).toHaveLength(200);
  });
});
