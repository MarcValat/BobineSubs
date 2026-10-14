import { describe, expect, it } from "vitest";
import { densityPath } from "./CueNavigator";

describe("densityPath", () => {
  it("draws a bar where lines are, as tall as they fill their column", () => {
    // 400 columns over 400 s: one per second.
    const path = densityPath(
      [
        [0, 1],
        [10, 10.5],
      ],
      400,
      0,
      10,
    );
    const bars = path.split("M").filter(Boolean);
    expect(bars).toHaveLength(2);
    expect(bars[0]).toMatch(/^0\.0 0\.0h/);
    // Half the column: half the height.
    expect(bars[1]).toMatch(/^21\.5 5\.0h2\.15v5\.0/);
  });

  it("draws nothing for an episode of no length", () => {
    expect(densityPath([[0, 1]], 0, 0, 10)).toBe("");
  });
});
