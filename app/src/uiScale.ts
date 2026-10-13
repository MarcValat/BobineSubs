import { useSyncExternalStore } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { LogicalSize, currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { loadSetting, saveSetting } from "./util";

/** The interface's size, in percent: Options' "Interface size". */
export const UI_SCALES = [90, 100, 110, 125] as const;
export type UiScale = (typeof UI_SCALES)[number];

const UI_SCALE_KEY = "syncsubtitles.uiScale";

/** The smallest room the layout is made for, at 100% (tauri.conf.json's
 * minWidth/minHeight): everything fits there, nothing below. */
const MIN_LAYOUT = { width: 1024, height: 640 };

/** Below that, text gets too small to read even zoomed out to fit. */
const SMALLEST_ZOOM = 0.6;

export function loadUiScale(): UiScale {
  const saved = Number(loadSetting(UI_SCALE_KEY));
  return (UI_SCALES as readonly number[]).includes(saved) ? (saved as UiScale) : 100;
}

export function saveUiScale(scale: UiScale): void {
  saveSetting(UI_SCALE_KEY, scale === 100 ? null : String(scale));
  void applyUiScale();
}

/** The zoom in use, in percent: the chosen size, or less where the screen
 * has no room for the layout at that size (shown in Options). */
let effective: number = loadUiScale();
const listeners = new Set<() => void>();

export function useEffectiveUiScale(): number {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => effective,
  );
}

/** Zooms the whole page to the chosen interface size -- the WebView's own
 * zoom, so text, icons, borders and the layout's room all follow, as with
 * a browser's zoom -- and keeps the window's minimum size the layout's at
 * that zoom. On a screen without room for that minimum (the window's free
 * area, taskbar excluded), the zoom goes down until it fits: the whole
 * interface stays on screen, if smaller. Again whenever the window moves
 * to another screen. Nothing outside Tauri (a plain browser). */
async function applyUiScale(): Promise<void> {
  if (!isTauri()) return;
  let zoom = loadUiScale() / 100;
  let room = { width: Infinity, height: Infinity };
  try {
    const monitor = await currentMonitor();
    if (monitor) {
      const area = monitor.workArea.size.toLogical(monitor.scaleFactor);
      room = { width: area.width, height: area.height };
      // In steps of 5%, so the size shown in Options reads well.
      const fits = Math.floor(Math.min(room.width / MIN_LAYOUT.width, room.height / MIN_LAYOUT.height) * 20) / 20;
      zoom = Math.max(SMALLEST_ZOOM, Math.min(zoom, fits));
    }
  } catch {
    // no monitor known: the chosen size as is
  }
  const min = new LogicalSize(Math.min(MIN_LAYOUT.width * zoom, room.width), Math.min(MIN_LAYOUT.height * zoom, room.height));
  await Promise.all([
    getCurrentWebview()
      .setZoom(zoom)
      .catch(() => {}),
    applyMinSize(min),
  ]);
  const percent = Math.round(zoom * 100);
  if (percent !== effective) {
    effective = percent;
    listeners.forEach((listener) => listener());
  }
}

/** The minimum size last given to the window, and one waiting for it to
 * be unmaximized (applyMinSize). */
let appliedMin: LogicalSize | null = null;
let pendingMin: LogicalSize | null = null;

/** Gives the window `min` as its minimum size, and grows it to that if it's
 * smaller. Not while it's maximized: on Windows, a new minimum size makes
 * the window take a normal size again -- a window snapped maximized on
 * another screen came back out of it. It waits for the window to be
 * unmaximized then (startUiScale). Nothing when it's the minimum already. */
async function applyMinSize(min: LogicalSize): Promise<void> {
  if (appliedMin && appliedMin.width === min.width && appliedMin.height === min.height) {
    pendingMin = null;
    return;
  }
  const win = getCurrentWindow();
  try {
    if (await win.isMaximized()) {
      pendingMin = min;
      return;
    }
    pendingMin = null;
    appliedMin = min;
    await win.setMinSize(min);
    // A bigger size can need more room than the window has: it grows to it.
    const size = (await win.innerSize()).toLogical(await win.scaleFactor());
    if (size.width < min.width || size.height < min.height) {
      await win.setSize(new LogicalSize(Math.max(size.width, min.width), Math.max(size.height, min.height)));
    }
  } catch {
    // left as it is
  }
}

/** Applies the interface size now and keeps it fitting the window's screen:
 * once at startup (main.tsx), before the first render. */
export async function startUiScale(): Promise<void> {
  if (!isTauri()) return;
  await applyUiScale();
  const win = getCurrentWindow();
  // Another screen: another size or scale. Only once a move ends: dragged
  // across screens, the window passes over several, and its snapping
  // (maximized at the top of a screen) happens as the drag ends.
  let timer: number | undefined;
  const settle = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void applyUiScale(), 300);
  };
  win.onMoved(settle).catch(() => {});
  win.onScaleChanged(settle).catch(() => {});
  // A minimum size kept waiting while the window was maximized.
  win
    .onResized(() => {
      if (pendingMin) void applyMinSize(pendingMin);
    })
    .catch(() => {});
}
