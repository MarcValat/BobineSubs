import { describe, expect, it } from "vitest";
import { clock, fileName, isSubtitleFile, offset } from "./format";

describe("clock", () => {
  it("shows hours only when there are some", () => {
    expect(clock(3723.4)).toBe("1:02:03.4");
    expect(clock(123.4)).toBe("2:03.4");
  });

  it("pads the seconds, with or without decimals", () => {
    expect(clock(-5)).toBe("-0:05.0");
    expect(clock(65, 0)).toBe("1:05");
  });
});

describe("offset", () => {
  it("always shows its sign, a true minus for a negative one", () => {
    expect(offset(1.06)).toBe("+1.060 s");
    expect(offset(0)).toBe("+0.000 s");
    expect(offset(-0.5)).toBe("−0.500 s");
  });
});

describe("fileName / isSubtitleFile", () => {
  it("reads Windows and Linux paths", () => {
    expect(fileName("C:\\Séries\\E01.mkv")).toBe("E01.mkv");
    expect(fileName("/home/marc/E01.fr.srt")).toBe("E01.fr.srt");
    expect(fileName("E01.mkv")).toBe("E01.mkv");
  });

  it("knows subtitle files by their extension, whatever its case", () => {
    expect(isSubtitleFile("E01.FR.SRT")).toBe(true);
    expect(isSubtitleFile("E01.ass")).toBe(true);
    expect(isSubtitleFile("E01.mkv")).toBe(false);
    expect(isSubtitleFile("README")).toBe(false);
  });
});
