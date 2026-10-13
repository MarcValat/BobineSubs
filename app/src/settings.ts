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
