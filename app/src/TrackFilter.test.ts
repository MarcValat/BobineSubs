import { describe, expect, it } from "vitest";
import type { TrackInfo } from "./api";
import { awaitsCues, resolveTracks } from "./TrackFilter";

const track = (index: number, language: string, forced = false, format: string | null = "ass"): TrackInfo => ({
  index,
  codec: format ?? "dvb_teletext",
  format,
  language,
  title: null,
  forced,
  default: false,
});

describe("awaitsCues (a reference picked only once the line counts are read)", () => {
  const english = [track(0, "eng"), track(1, "eng")];

  it("waits while several tracks could be the reference", () => {
    expect(awaitsCues(english, null, "", [])).toBe(true);
    // Read: the counts decide, and the pick no longer changes.
    expect(awaitsCues(english, { 0: 10, 1: 700 }, "", [])).toBe(false);
    expect(resolveTracks(english, { 0: 10, 1: 700 }, "", []).reference?.index).toBe(1);
  });

  it("doesn't when only one could be, or one is picked by hand", () => {
    expect(awaitsCues([track(0, "eng"), track(1, "eng", true)], null, "", [])).toBe(false);
    expect(awaitsCues([track(0, "eng"), track(1, "fre", false, null)], null, "", [])).toBe(false);
    expect(awaitsCues(english, null, "", [], { reference: 0, targets: [] })).toBe(false);
  });
});
