import { describe, expect, it } from "vitest";
import type { Analysis, Segment } from "./api";
import { segmentFor, withSegments } from "./retime";

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
