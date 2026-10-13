import { describe, expect, it } from "vitest";
import { MIN_VIEW_DURATION_S, panView, zoomView } from "./timeView";

describe("zoomView", () => {
  it("keeps the time under the pointer at the same place on screen", () => {
    const view = zoomView({ start: 10, duration: 40 }, 0.5, 30, 1000);
    expect(view).toEqual({ start: 20, duration: 20 });
    // 30 s was halfway across before, it still is.
    expect((30 - view.start) / view.duration).toBe(0.5);
  });

  it("never zooms in past the minimum view", () => {
    expect(zoomView({ start: 0, duration: 10 }, 0.1, 5, 100)).toEqual({ start: 2.5, duration: MIN_VIEW_DURATION_S });
  });

  it("shows a track shorter than the minimum view whole", () => {
    expect(zoomView({ start: 0, duration: 3 }, 0.5, 1, 3)).toEqual({ start: 0, duration: 3 });
  });

  it("never zooms out past the track, nor starts before it", () => {
    expect(zoomView({ start: 50, duration: 50 }, 4, 90, 100)).toEqual({ start: 0, duration: 100 });
  });

  it("keeps the view inside the track near its end", () => {
    const view = zoomView({ start: 80, duration: 20 }, 1.5, 99, 100);
    expect(view.duration).toBe(30);
    expect(view.start + view.duration).toBeLessThanOrEqual(100);
  });
});

describe("panView", () => {
  it("moves the view by the given seconds", () => {
    expect(panView({ start: 10, duration: 20 }, 5, 100)).toEqual({ start: 15, duration: 20 });
  });

  it("stops at the track's start and end", () => {
    expect(panView({ start: 10, duration: 20 }, -50, 100)).toEqual({ start: 0, duration: 20 });
    expect(panView({ start: 70, duration: 20 }, 50, 100)).toEqual({ start: 80, duration: 20 });
  });

  it("stays at 0 when the view is longer than the track", () => {
    expect(panView({ start: 0, duration: 200 }, 10, 100)).toEqual({ start: 0, duration: 200 });
  });
});
