import { describe, expect, it } from "vitest";
import type { Analysis, Segment } from "./api";
import { editLine, lineFates, renderEdits, segmentFor, skipCleanup, timeLine, withSegments } from "./retime";

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

describe("lines timed by hand", () => {
  const cues: [number, number][] = [
    [10, 12],
    [102, 104],
  ];

  it("keeps a line's own times wherever it is, unless taken out", () => {
    const timed = withSegments(analysis(cues), withGap, { keep: [], drop: [], timing: { 0: [20, 21.5], 1: [100, 101] } });
    expect(timed.target_cues.map((c) => c.corrected)).toEqual([
      [20, 21.5],
      [100, 101],
    ]);
    expect(lineFates(timed)).toEqual([
      { index: 0, fate: "timed" },
      { index: 1, fate: "timed" },
    ]);
    const out = withSegments(analysis(cues), withGap, { keep: [], drop: [0], timing: { 0: [20, 21.5] } });
    expect(out.target_cues[0].corrected).toBeNull();
  });

  it("sets or forgets a line's times, the other edits as they are", () => {
    let edits = timeLine({ keep: [1], drop: [], skip: [0] }, 0, [1.23456, 2.5]);
    expect(edits).toEqual({ keep: [1], drop: [], skip: [0], timing: { 0: [1.235, 2.5] } });
    edits = skipCleanup(editLine(edits, 1, "reset"), [1], true);
    expect(edits.timing).toEqual({ 0: [1.235, 2.5] });
    expect(renderEdits(edits)).toEqual({ keep: [], drop: [], clean_skip: [0, 1], timing: { 0: [1.235, 2.5] } });
    expect(timeLine(edits, 0, null).timing).toEqual({});
  });
});

describe("lines at a segment boundary", () => {
  // Target gains a second at 10 s: the second segment's lines 1 s earlier.
  const gained = [seg(0, 10, 0, 0), seg(10, 20, 1, 1)];
  const rounded = (cues: [number, number][]) => corrected(gained, cues).map((c) => c && c.map((t) => +t.toFixed(3)));

  it("ends a line running into the next segment's first one where it starts", () => {
    expect(
      rounded([
        [5, 8.4],
        [8, 9.8],
        [10.2, 12],
        [11.5, 13],
      ]),
    ).toEqual([
      [5, 8.4],
      [8, 9.2],
      [9.2, 11],
      [10.5, 12],
    ]);
  });

  it("starts the next later rather than leave one too short, in their order", () => {
    expect(
      rounded([
        [9, 9.9],
        [10.2, 12],
      ]),
    ).toEqual([
      [9, 9.8],
      [9.8, 11],
    ]);
    // Too little time for both: the next runs on, up to the line after it...
    expect(
      rounded([
        [9.4, 10],
        [10.6, 11.6],
      ]),
    ).toEqual([
      [9.4, 10.2],
      [10.2, 11],
    ]);
    // ...then the first starts earlier, down to the line before it...
    expect(
      rounded([
        [9.4, 10],
        [10.6, 11.6],
        [11.7, 12.5],
      ]),
    ).toEqual([
      [9.1, 9.9],
      [9.9, 10.7],
      [10.7, 11.5],
    ]);
    // ...and when that's not enough, shared in proportion to their lengths.
    expect(
      rounded([
        [8, 9.3],
        [9.4, 10],
        [10.6, 11.6],
        [11.7, 12.5],
      ]),
    ).toEqual([
      [8, 9.3],
      [9.3, 9.844],
      [9.844, 10.7],
      [10.7, 11.5],
    ]);
  });

  it("leaves lines timed by hand as they are", () => {
    const timed = withSegments(
      analysis([
        [8, 9.8],
        [10.2, 12],
      ]),
      gained,
      { keep: [], drop: [], timing: { 0: [8, 9.8] } },
    );
    expect(timed.target_cues[0].corrected).toEqual([8, 9.8]);
  });
});
