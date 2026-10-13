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

/** Dev only (always null in production builds): a `?name=value` parameter of
 * the page's URL. They let automated screenshots in a plain browser do what
 * a system dialog would -- `?update=1`. */
export function devParam(name: string): string | null {
  if (!import.meta.env.DEV) return null;
  return new URLSearchParams(window.location.search).get(name);
}

/** A typed field's props: no list of earlier entries under it (the
 * WebView's autofill) and no spelling underlines ("VFF", "JP AAC 2.0"). */
export const FIELD_PROPS = { autoComplete: "off", spellCheck: false } as const;
