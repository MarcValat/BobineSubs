import { getCurrentWindow } from "@tauri-apps/api/window";
import { loadSetting, saveSetting } from "./settings";

/** "system" follows Windows; the others force it. From Bobine Audio. */
export type ThemeChoice = "system" | "light" | "dark";

const THEME_KEY = "syncsubtitles.theme";

export function loadTheme(): ThemeChoice {
  const saved = loadSetting(THEME_KEY);
  return saved === "light" || saved === "dark" ? saved : "system";
}

/** Applies `choice` to the page (App.css's colors follow `data-theme`) and
 * to the window's title bar, and remembers it for the next session. */
export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
  saveSetting(THEME_KEY, choice === "system" ? null : choice);
  // Outside Tauri (the dev server in a plain browser) there's no window to theme.
  try {
    getCurrentWindow()
      .setTheme(choice === "system" ? null : choice)
      .catch(() => {});
  } catch {
    // not running in Tauri
  }
}
