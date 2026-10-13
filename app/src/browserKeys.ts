// The WebView's own browser features, which mean nothing in this app and
// some of which lose the user's work: F5 / Ctrl+R reload the page (the list
// and its analyses gone), Ctrl+F / F3 open a find bar, Ctrl+P print, Ctrl+S
// save the page, Ctrl+U its source, F7 caret browsing, Alt+← / Alt+→ the
// history, a touchpad's pinch zooms the page. Tauri doesn't expose
// WebView2's switches for them; what the page cancels, the WebView doesn't
// act on. The developer tools aren't in the compiled app, and its zoom keys
// are off (Tauri's zoomHotkeysEnabled). The app's own shortcuts and text
// editing (Ctrl+Z / Y, Ctrl+A / C / V / X) are left alone.

const PLAIN = new Set(["F3", "F5", "F7", "BrowserBack", "BrowserForward", "BrowserRefresh", "BrowserSearch"]);
const WITH_CTRL = new Set(["r", "f", "g", "p", "s", "u", "j", "h", "o"]);

/** Whether `e` is one of the WebView's browser shortcuts. */
export function isBrowserShortcut(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey">): boolean {
  if (PLAIN.has(e.key)) return true;
  if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) return true;
  return (e.ctrlKey || e.metaKey) && !e.altKey && WITH_CTRL.has(e.key.toLowerCase());
}

/** The compiled app's window behaves as an app, not a web page: no
 * browser right-click menu (Reload, Inspect, Save as...), no browser
 * shortcuts. Kept in `tauri dev`, where Inspect is handy. */
export function blockBrowserFeatures(): void {
  window.addEventListener("contextmenu", (e) => e.preventDefault());
  // A touchpad's pinch comes as a wheel with Ctrl: it would zoom the whole
  // window like a page (the WebView's own pinch zoom, apart from the zoom
  // keys Tauri turns off). The app's zooms use the plain wheel.
  window.addEventListener(
    "wheel",
    (e) => {
      if (e.ctrlKey) e.preventDefault();
    },
    { passive: false },
  );
  window.addEventListener(
    "keydown",
    (e) => {
      if (isBrowserShortcut(e)) e.preventDefault();
    },
    // Before anything in the page gets it.
    { capture: true },
  );
}
