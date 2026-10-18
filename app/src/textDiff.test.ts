import { describe, expect, it } from "vitest";
import { textDiff } from "./textDiff";

describe("textDiff", () => {
  it("marks what each side changes, the rest the same", () => {
    expect(textDiff("Pourquoi ?", "Pourquoi ?")).toEqual({
      before: [
        { text: "Pourquoi", changed: false },
        { text: " ", changed: true },
        { text: "?", changed: false },
      ],
      after: [
        { text: "Pourquoi", changed: false },
        { text: " ", changed: true },
        { text: "?", changed: false },
      ],
    });
  });

  it("finds a change at each end", () => {
    const { before, after } = textDiff("-Oui  !", "- Oui !");
    expect(before.filter((p) => p.changed).map((p) => p.text)).toEqual([" "]);
    expect(after.filter((p) => p.changed).map((p) => p.text)).toEqual([" "]);
    expect(after.map((p) => p.text).join("")).toBe("- Oui !");
  });

  it("gives a line all changed when nothing is common", () => {
    expect(textDiff("abc", "")).toEqual({ before: [{ text: "abc", changed: true }], after: [] });
  });
});
