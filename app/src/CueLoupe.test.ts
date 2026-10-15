import { describe, expect, it } from "vitest";
import { dragTimes, laneBlocks, type Cue } from "./CueLoupe";

const cue = (a: number, b: number): Cue => ({ a, b, text: `${a}`, kind: "ref" });

describe("laneBlocks", () => {
  it("draws each line in view at its place, as wide as it lasts", () => {
    const blocks = laneBlocks([cue(0, 2), cue(5, 8), cue(20, 21)], 0, 10, 1000);
    expect(blocks.map(({ x, w, count }) => [x, w, count])).toEqual([
      [0, 200, 1],
      [500, 300, 1],
    ]);
    expect(blocks[1].cue?.a).toBe(5);
  });

  it("merges lines too narrow to read that are close together", () => {
    // 1000 s over 1000 px: each line 1 px, 1.5 px apart.
    const cues = Array.from({ length: 10 }, (_, k) => cue(k * 2.5, k * 2.5 + 1));
    const blocks = laneBlocks(cues, 0, 1000, 1000);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ x: 0, cue: null, count: 10 });
    expect(blocks[0].w).toBeCloseTo(23.5);
  });

  it("keeps a readable line apart, and lines far apart", () => {
    const blocks = laneBlocks([cue(0, 1), cue(1.5, 100), cue(200, 201), cue(300, 301)], 0, 1000, 1000);
    expect(blocks.map((b) => b.count)).toEqual([1, 1, 1, 1]);
  });

  it("cuts a line across the lane's edges", () => {
    const blocks = laneBlocks([cue(-1, 2), cue(9, 12)], 0, 10, 1000);
    expect(blocks.map(({ x, w }) => [x, w])).toEqual([
      [0, 200],
      [900, 100],
    ]);
  });
});

describe("dragTimes (a line picked in the editor, dragged)", () => {
  it("moves an edge, or the whole line", () => {
    expect(dragTimes("start", 10, 12, -1, [], 0.1, 100)).toEqual([9, 12]);
    expect(dragTimes("end", 10, 12, 0.5, [], 0.1, 100)).toEqual([10, 12.5]);
    expect(dragTimes("move", 10, 12, 3, [], 0.1, 100)).toEqual([13, 15]);
  });

  it("lands an edge on a reference line's nearby", () => {
    expect(dragTimes("start", 10, 12, -1.05, [8.9, 9.5], 0.1, 100)).toEqual([8.9, 12]);
    // Moved: the edge nearer a snap lands on it, the line keeps its length.
    expect(dragTimes("move", 10, 12, 3, [12.98, 15.05], 0.1, 100)).toEqual([12.98, 14.98]);
    expect(dragTimes("move", 10, 12, 3, [20], 0.1, 100)).toEqual([13, 15]);
  });

  it("keeps the line readable and within the file", () => {
    expect(dragTimes("start", 10, 12, 5, [], 0.1, 100)).toEqual([11.8, 12]);
    expect(dragTimes("end", 10, 12, -5, [], 0.1, 100)).toEqual([10, 10.2]);
    expect(dragTimes("start", 1, 2, -5, [], 0.1, 100)).toEqual([0, 2]);
    expect(dragTimes("move", 90, 95, 10, [], 0.1, 100)).toEqual([95, 100]);
    expect(dragTimes("end", 90, 95, 10, [], 0.1, 100)).toEqual([90, 100]);
  });
});
