import { useSyncExternalStore } from "react";

// Settings remembered across sessions (from Bobine Audio). Browser storage
// can be unavailable or throw: the setting then just isn't remembered.

export function loadSetting(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Stores `value` under `key`; null forgets it. */
export function saveSetting(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // not remembered this time
  }
}

// A view using a setting follows a change made in Options right away.
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const CHECK_UPDATES_KEY = "syncsubtitles.checkUpdates";

/** Whether the app looks for an update on GitHub at startup (the default). */
export function loadCheckUpdates(): boolean {
  return loadSetting(CHECK_UPDATES_KEY) !== "0";
}

export function saveCheckUpdates(check: boolean): void {
  saveSetting(CHECK_UPDATES_KEY, check ? null : "0");
  listeners.forEach((listener) => listener());
}

export function useCheckUpdates(): boolean {
  return useSyncExternalStore(subscribe, loadCheckUpdates);
}
