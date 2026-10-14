import { useSyncExternalStore } from "react";
import { loadSetting, saveSetting } from "./util";

// Options' settings, remembered across sessions; a view using one follows
// a change made in Options right away. From Bobine Audio.
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function changed(): void {
  listeners.forEach((listener) => listener());
}

const CHECK_UPDATES_KEY = "syncsubtitles.checkUpdates";

/** Whether the app looks for an update on GitHub at startup (the default). */
function loadCheckUpdates(): boolean {
  return loadSetting(CHECK_UPDATES_KEY) !== "0";
}

export function saveCheckUpdates(check: boolean): void {
  saveSetting(CHECK_UPDATES_KEY, check ? null : "0");
  changed();
}

export function useCheckUpdates(): boolean {
  return useSyncExternalStore(subscribe, loadCheckUpdates);
}

const LIST_COLLAPSED_KEY = "syncsubtitles.listCollapsed";

/** Whether the file list is folded to a narrow column (both modes). */
function loadListCollapsed(): boolean {
  return loadSetting(LIST_COLLAPSED_KEY) === "1";
}

export function saveListCollapsed(collapsed: boolean): void {
  saveSetting(LIST_COLLAPSED_KEY, collapsed ? "1" : null);
  changed();
}

export function useListCollapsed(): boolean {
  return useSyncExternalStore(subscribe, loadListCollapsed);
}

const CLEAN_SUBTITLES_KEY = "syncsubtitles.cleanSubtitles";

/** Whether an export fixes the corrected SRT files' obvious faults too
 * (the engine's cleanup: the default). */
function loadCleanSubtitles(): boolean {
  return loadSetting(CLEAN_SUBTITLES_KEY) !== "0";
}

export function saveCleanSubtitles(clean: boolean): void {
  saveSetting(CLEAN_SUBTITLES_KEY, clean ? null : "0");
  changed();
}

export function useCleanSubtitles(): boolean {
  return useSyncExternalStore(subscribe, loadCleanSubtitles);
}
