import { describe, expect, it } from "vitest";
import { isBrowserShortcut } from "./browserKeys";

const key = (k: string, mods: { ctrl?: boolean; alt?: boolean; meta?: boolean; shift?: boolean } = {}) => ({
  key: k,
  ctrlKey: !!mods.ctrl,
  altKey: !!mods.alt,
  metaKey: !!mods.meta,
});

describe("isBrowserShortcut", () => {
  it("catches reload, find, print, save, source, caret browsing and history", () => {
    for (const k of ["F5", "F3", "F7"]) expect(isBrowserShortcut(key(k))).toBe(true);
    for (const k of ["r", "R", "f", "p", "s", "u"]) expect(isBrowserShortcut(key(k, { ctrl: true }))).toBe(true);
    expect(isBrowserShortcut(key("ArrowLeft", { alt: true }))).toBe(true);
    expect(isBrowserShortcut(key("BrowserBack"))).toBe(true);
  });

  it("leaves the app's shortcuts and text editing alone", () => {
    for (const k of ["z", "y", "a", "c", "v", "x"]) expect(isBrowserShortcut(key(k, { ctrl: true }))).toBe(false);
    for (const k of [" ", "ArrowUp", "ArrowDown", "ArrowLeft", "Escape", "Enter", "r", "f"]) expect(isBrowserShortcut(key(k))).toBe(false);
    // AltGr (Ctrl+Alt) types characters on French keyboards.
    expect(isBrowserShortcut(key("r", { ctrl: true, alt: true }))).toBe(false);
  });
});
