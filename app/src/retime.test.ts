import { describe, expect, it } from "vitest";
import type { Analysis, Segment } from "./api";
import { editLine, lineFates, segmentFor, withSegments } from "./retime";

const seg = (start_s: number, end_s: number, offset_start: number, offset_end: number): Segment => ({
  start_s,
  end_s,
  offset_start,
  offset_end,
  confidence: 0.9,
});

// In target time: [1, 101], then [105, 205] -- 4 s the reference doesn't
// have between them (a cut scene).
const withGap = [seg(0, 100, 1, 1), seg(100, 200, 5, 5)];
// In target time: [1, 101], then [97, 197] -- 4 s the target doesn't have.
const overlapping = [seg(0, 100, 1, 1), seg(100, 200, -3, -3)];

describe("segmentFor (the engine's retime.segment_for)", () => {
  it("finds the segment whose target span holds the time", () => {
    expect(segmentFor(50, withGap)).toBe(0);
    expect(segmentFor(150, withGap)).toBe(1);
  });

  it("gives nothing between two spans", () => {
    expect(segmentFor(103, withGap)).toBeNull();
  });

  it("cuts two overlapping spans at the middle", () => {
    expect(segmentFor(98, overlapping)).toBe(0);
    expect(segmentFor(100, overlapping)).toBe(1);
  });

  it("extends the first and last segments outwards", () => {
    expect(segmentFor(0.5, withGap)).toBe(0);
    expect(segmentFor(300, withGap)).toBe(1);
    expect(segmentFor(5, [])).toBeNull();
  });
});

const analysis = (cues: [number, number][]): Analysis => ({
  reference: { path: "ref.mkv", index: null },
  target: { path: "vf.srt", index: null },
  reference_choice: null,
  ratio: 1,
  ratio_name: null,
  segments: [],
  reference_cues: [],
  target_cues: cues.map(([start, end]) => ({ start, end, text: "", group: 0, corrected: null })),
  warnings: [],
});

const corrected = (segments: Segment[], cues: [number, number][]) =>
  withSegments(analysis(cues), segments).target_cues.map((c) => c.corrected);

describe("withSegments", () => {
  it("keeps the new segments", () => {
    expect(withSegments(analysis([]), withGap).segments).toBe(withGap);
  });

  it("moves each cue by its segment's offset, dropping those in a gap", () => {
    expect(
      corrected(withGap, [
        [10, 12],
        [102, 104],
        [150, 152],
      ]),
    ).toEqual([[9, 11], null, [145, 147]]);
  });

  it("follows a drift's speed", () => {
    const [[start, end]] = corrected([seg(0, 100, 0, 10)], [[55, 66]]) as [number, number][];
    expect(start).toBeCloseTo(50);
    expect(end).toBeCloseTo(60);
  });

  it("drops a cue moved before the start, clips one moved across it", () => {
    expect(
      corrected(
        [seg(0, 100, 5, 5)],
        [
          [1, 3],
          [4, 7],
        ],
      ),
    ).toEqual([null, [0, 2]]);
  });
});

describe("lines kept or taken out by hand", () => {
  const cues: [number, number][] = [
    [10, 12],
    [102, 104],
    [150, 152],
    [1, 1.5],
  ];

  it("keeps a line of a gap through the nearest segment, takes out any", () => {
    // The gap's line (target 102-104) is nearer the first span (it ends at 101).
    const kept = withSegments(analysis(cues), withGap, { keep: [1], drop: [2] });
    expect(kept.target_cues.map((c) => c.corrected)).toEqual([[9, 11], [101, 103], null, [0, 0.5]]);
    expect(kept.edits).toEqual({ keep: [1], drop: [2] });
  });

  it("says why each line is left out, or kept", () => {
    const shifted = [seg(0, 100, 5, 5), seg(100, 200, 9, 9)];
    // Line 4 lands before the start; line 2 in the gap (target 105..109).
    expect(lineFates(withSegments(analysis([...cues.slice(0, 3), [3, 4], [106, 107]]), shifted))).toEqual([
      { index: 3, fate: "start" },
      { index: 4, fate: "gap" },
    ]);
    const edited = withSegments(analysis(cues), withGap, { keep: [1], drop: [0] });
    expect(lineFates(edited)).toEqual([
      { index: 0, fate: "dropped" },
      { index: 1, fate: "kept" },
    ]);
  });

  it("changes one line's fate at a time", () => {
    let edits = editLine(undefined, 3, "keep");
    expect(edits).toEqual({ keep: [3], drop: [] });
    edits = editLine(edits, 3, "drop");
    expect(edits).toEqual({ keep: [], drop: [3] });
    expect(editLine(edits, 3, "reset")).toEqual({ keep: [], drop: [] });
  });
});
