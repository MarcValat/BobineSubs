import { describe, expect, it } from "vitest";
import type { Segment } from "./api";
import { t } from "./i18n";
import { describeSegments, drawnOffsets, offsetRange, offsetTicks, placeLabels, segmentOffsetLabel } from "./SegmentChart";

const seg = (offset_start: number, offset_end: number, confidence = 1, start_s = 0, end_s = 10): Segment => ({
  start_s,
  end_s,
  offset_start,
  offset_end,
  confidence,
});

describe("segmentOffsetLabel / drawnOffsets", () => {
  it("draws and labels a constant flat, at its mean", () => {
    expect(drawnOffsets(seg(1, 1.02))).toEqual([1.01, 1.01]);
    expect(segmentOffsetLabel(seg(1, 1.02))).toBe("+1.010 s");
  });

  it("keeps a drift's slope", () => {
    expect(drawnOffsets(seg(1, 2))).toEqual([1, 2]);
    expect(segmentOffsetLabel(seg(1, 2))).toBe("+1.000 s → +2.000 s");
  });
});

describe("offsetRange / offsetTicks", () => {
  it("always includes 0, with room above and below", () => {
    const [min, max] = offsetRange([1, 2]);
    expect(min).toBeCloseTo(-0.3);
    expect(max).toBeCloseTo(2.3);
    expect(offsetRange([])).toEqual([-1.3, 1.3]);
  });

  it("puts round ticks over the range", () => {
    expect(offsetTicks(-0.3, 2.3)).toEqual([0, 1, 2]);
    const ticks = offsetTicks(0, 1);
    expect(ticks).toHaveLength(6);
    ticks.forEach((tick, i) => expect(tick).toBeCloseTo(i * 0.2));
    expect(offsetTicks(1, 1)).toEqual([]);
  });
});

describe("describeSegments", () => {
  it("counts the segments, the jumps between them, the drifts and the unreliable ones", () => {
    const m = t().chart;
    expect(describeSegments([seg(1, 1)])).toBe(m.segments(1));
    expect(describeSegments([seg(1, 1, 1, 0, 10), seg(1.5, 1.5, 0.3, 10, 20), seg(1.5, 2.5, 1, 20, 30)])).toBe(
      [m.segments(3), m.jumps(1), m.drifts(1), m.unreliableCount(1)].join(" · "),
    );
  });
});

describe("placeLabels", () => {
  const label = (x: number, y: number, weight = 1) => ({ x, y, width: 100, weight });

  it("puts a label above its line, kept within the plot's sides", () => {
    expect(placeLabels([label(500, 100), label(10, 100)], 1000, 200)).toEqual([
      { x: 500, y: 92 },
      { x: 50, y: 92 },
    ]);
  });

  it("moves a shorter segment's label out of a longer one's way, else hides it", () => {
    const [long, short, third, fourth, fifth] = placeLabels(
      [label(500, 100, 10), label(520, 100, 1), label(510, 100, 0.5), label(505, 100, 0.4), label(515, 100, 0.3)],
      1000,
      200,
    );
    expect(long).toEqual({ x: 500, y: 92 });
    expect(short).toEqual({ x: 520, y: 116 });
    expect(third).toEqual({ x: 510, y: 78 });
    expect(fourth).toEqual({ x: 505, y: 130 });
    expect(fifth).toBeNull();
  });
});
