import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useT } from "./i18n";
import { devParam } from "./util";

/** The window's own buttons -- réduire, agrandir / restaurer, fermer -- at
 * the right end of the top bar: the window has no system title bar
 * (tauri.conf.json's decorations), the top bar is its title bar (moved by
 * dragging it, maximized by a double click: data-tauri-drag-region). The
 * same on Windows and Linux (KDE, GNOME). None in a plain browser but with
 * `?windowControls=1` (dev, for screenshots). */
export function WindowControls() {
  const t = useT();
  const inApp = isTauri();
  const [maximized, setMaximized] = useState(false);

  // The middle button shows what it'd do: restore a maximized window.
  useEffect(() => {
    if (!inApp) return;
    const win = getCurrentWindow();
    let stop: (() => void) | undefined;
    let gone = false;
    const update = () =>
      win.isMaximized().then(
        (m) => !gone && setMaximized(m),
        () => {},
      );
    update();
    win.onResized(update).then((unlisten) => (gone ? unlisten() : (stop = unlisten)));
    return () => {
      gone = true;
      stop?.();
    };
  }, [inApp]);

  if (!inApp && devParam("windowControls") !== "1") return null;
  const win = inApp ? getCurrentWindow() : null;
  const buttons = [
    { label: t.window.minimize, kind: "minimize", icon: <path d="M1 6h10" />, onClick: () => win?.minimize() },
    maximized
      ? {
          label: t.window.restore,
          kind: "maximize",
          icon: (
            <>
              <rect x="1.5" y="3.5" width="7" height="7" />
              <path d="M3.5 3.5V1.5h7v7h-2" />
            </>
          ),
          onClick: () => win?.toggleMaximize(),
        }
      : {
          label: t.window.maximize,
          kind: "maximize",
          icon: <rect x="1.5" y="1.5" width="9" height="9" />,
          onClick: () => win?.toggleMaximize(),
        },
    { label: t.window.close, kind: "close", icon: <path d="M2 2l8 8M10 2l-8 8" />, onClick: () => win?.close() },
  ];
  return (
    <div className={maximized ? "window-controls window-controls-maximized" : "window-controls"}>
      {buttons.map((b) => (
        // No tooltip: these three are the same in every app.
        <button key={b.kind} className={`window-button window-${b.kind}`} aria-label={b.label} onClick={b.onClick}>
          <svg viewBox="0 0 12 12" aria-hidden="true">
            {b.icon}
          </svg>
        </button>
      ))}
    </div>
  );
}
