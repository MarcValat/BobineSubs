/** What to show for a caught error: its message, or the thing itself. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** A setting remembered across sessions (last folder, output folder, theme).
 * Browser storage can be unavailable or throw: the setting then just isn't
 * remembered, nothing else depends on it. */
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
