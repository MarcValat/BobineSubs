import { getCurrentWindow } from "@tauri-apps/api/window";
import { loadSetting, saveSetting } from "./util";

/** "system" follows the OS; the others force it. */
export type ThemeChoice = "system" | "light" | "dark";

const THEME_KEY = "syncsubtitles.theme";

export function loadTheme(): ThemeChoice {
  const saved = loadSetting(THEME_KEY);
  return saved === "light" || saved === "dark" ? saved : "system";
}

/** Applies `choice` to the page (App.css's colors follow `data-theme`) and
 * to the window's title bar, and remembers it for the next session. Once
 * the app shows, the page cross-fades into it (crossFade). */
export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  crossFade(() => {
    if (choice === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", choice);
  });
  saveSetting(THEME_KEY, choice === "system" ? null : choice);
  // Outside Tauri (the dev server in a plain browser) there's no window to theme.
  try {
    getCurrentWindow()
      .setTheme(choice === "system" ? null : choice)
      .catch(() => {});
  } catch {
    // not running in Tauri
  }
  syncWindowBackground(choice);
}

// App.css's --bg, per theme.
const WINDOW_BACKGROUND = { light: "#f1f6f5", dark: "#091113" };
const systemDark = window.matchMedia?.("(prefers-color-scheme: dark)");

/** The window's own background in the page's: what shows for an instant
 * where a fast resize uncovers the window before the page is drawn there
 * (black otherwise). Followed when the system theme changes too. */
function syncWindowBackground(choice: ThemeChoice = loadTheme()): void {
  const dark = choice === "system" ? !!systemDark?.matches : choice === "dark";
  try {
    getCurrentWindow()
      .setBackgroundColor(WINDOW_BACKGROUND[dark ? "dark" : "light"])
      .catch(() => {});
  } catch {
    // not running in Tauri
  }
}
systemDark?.addEventListener("change", () => syncWindowBackground());

/** Whether the page has been drawn yet: the theme applied at startup
 * (main.tsx) has nothing to fade from. The module script runs once the
 * document is parsed, so `document.body` exists by then already. */
let painted = false;

/** Linux's WebKitGTK crashes on a view transition with some GPU drivers
 * (2.52, NVIDIA: a segfault in AcceleratedBackingStore::update as it enters
 * accelerated compositing -- the 2.0.0 .deb closed seconds after opening). */
const LINUX = navigator.userAgent.includes("Linux");

/** Runs `change` as one cross-fade of the whole window (the View Transitions
 * API, App.css's ::view-transition rules): every text, panel, icon and
 * waveform fades at the same pace. Fading each element's own colors left
 * out the ones that inherit theirs (a drop zone's hint stayed sharp while
 * its button faded). Instant where there's nothing to fade from yet (the
 * first paint), on Linux (see LINUX), where the engine lacks the API, and
 * with reduced motion. The controls' own hover transitions are paused
 * meanwhile, or they'd fade a second time inside the new picture. */
function crossFade(change: () => void): void {
  const root = document.documentElement;
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const first = !painted;
  painted = true;
  if (first || LINUX || reduced || typeof document.startViewTransition !== "function") {
    change();
    return;
  }
  root.classList.add("theme-switching");
  const transition = document.startViewTransition(change);
  transition.finished.finally(() => root.classList.remove("theme-switching"));
}
