import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { devParam, errorMessage } from "./util";
import { DownloadIcon } from "./icons";
import { Tooltip } from "./InfoTip";
import { useT } from "./i18n";
import { useCheckUpdates } from "./settings";

// "error": the download failed, the app still works; "failed": the install
// did, after the engine was stopped.
type Phase = "idle" | "available" | "downloading" | "ready" | "error" | "failed";

/** What this component needs from an update (the plugin's Update, or the dev stand-in). */
interface PendingUpdate {
  version: string;
  download(onEvent: (event: DownloadEvent) => void): Promise<void>;
  install(): Promise<void>;
}
type DownloadEvent =
  { event: "Started"; data: { contentLength?: number } } | { event: "Progress"; data: { chunkLength: number } } | { event: "Finished" };

/** Dev only (see devParam): `?update=1` shows a pretend update. */
function devUpdate(): PendingUpdate | null {
  if (devParam("update") !== "1") return null;
  return {
    version: "9.9.9",
    download: () => Promise.reject(new Error("pretend update (dev)")),
    install: () => Promise.resolve(),
  };
}

/**
 * Checks GitHub Releases (see src-tauri/tauri.conf.json's
 * plugins.updater.endpoints) once on mount and, if a newer signed build
 * exists, shows an icon next to Options; its menu offers to install it in
 * place. Silently does nothing on failure -- no network, GitHub briefly
 * unreachable -- since a background update check must never interrupt or
 * clutter the app over something this optional.
 */
export function UpdateButton() {
  const t = useT();
  const [update, setUpdate] = useState<PendingUpdate | null>(devUpdate);
  const [phase, setPhase] = useState<Phase>(() => (devUpdate() ? "available" : "idle"));
  const [progress, setProgress] = useState<{ downloaded: number; total: number | null }>({ downloaded: 0, total: null });
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Off in Options: no request to GitHub at all.
  const checkUpdates = useCheckUpdates();
  useEffect(() => {
    if (devUpdate() || !checkUpdates) return;
    let cancelled = false;
    check()
      .then((result) => {
        if (!cancelled && result) {
          setUpdate(result);
          setPhase("available");
        }
      })
      .catch(() => {
        // See docstring above -- deliberately silent.
      });
    return () => {
      cancelled = true;
    };
  }, [checkUpdates]);

  // The menu closes on a click elsewhere or Escape.
  useEffect(() => {
    if (!open) return;
    function onPointer(e: PointerEvent) {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function install() {
    if (!update) return;
    setPhase("downloading");
    setError(null);
    // Downloaded first, with the engine still running: a failed download
    // (network...) leaves the app fully usable, and it can be retried.
    try {
      await update.download((event) => {
        if (event.event === "Started") {
          setProgress({ downloaded: 0, total: event.data.contentLength ?? null });
        } else if (event.event === "Progress") {
          setProgress((p) => ({ downloaded: p.downloaded + event.data.chunkLength, total: p.total }));
        }
      });
    } catch (err) {
      setPhase("error");
      setError(errorMessage(err));
      return;
    }
    setPhase("ready");
    try {
      // Real bug: the installer failed to overwrite the sidecar's own exe
      // ("Error opening file for writing") because it was still running --
      // Tauri's updater closes/replaces the main app for us, but has no
      // idea this separately-managed child process exists. Stop it only
      // now, right before installing, so its file is free by the time the
      // installer gets to it; relaunch() below starts a fresh app (and
      // sidecar) regardless.
      await invoke("stop_sidecar");
      await update.install();
      await relaunch();
    } catch (err) {
      // The engine is stopped by now: only a restart brings it back.
      setPhase("failed");
      setError(errorMessage(err));
    }
  }

  if (phase === "idle" || !update || (phase === "available" && !checkUpdates && !devUpdate())) return null;

  const percent = progress.total ? Math.round((progress.downloaded / progress.total) * 100) : null;
  const busy = phase === "downloading" || phase === "ready";
  const failed = phase === "error" || phase === "failed";
  const title =
    phase === "downloading" ? t.update.downloadingTitle(percent) : failed ? t.update.failedTitle : t.update.availableTitle(update.version);

  return (
    <div className="update-box" ref={boxRef}>
      <Tooltip text={title}>
        <button
          className={`icon-button update-button${failed ? " update-button-failed" : ""}${busy ? " update-button-busy" : ""}`}
          aria-label={title}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <DownloadIcon />
          <span className="update-dot" aria-hidden="true" />
        </button>
      </Tooltip>
      {open && (
        <div className="top-menu update-menu" role="dialog">
          <p className="update-menu-title">{failed ? t.update.failedHeading : t.update.availableHeading(update.version)}</p>
          {phase === "available" && (
            <>
              <p className="update-menu-note">{t.update.restartNote}</p>
              <button className="primary-button" onClick={install}>
                {t.update.install}
              </button>
            </>
          )}
          {phase === "downloading" && <p>{t.update.downloading(percent)}</p>}
          {phase === "ready" && <p>{t.update.installing}</p>}
          {phase === "error" && (
            <>
              <p className="error">{t.update.downloadFailed(error ?? "")}</p>
              <button className="primary-button" onClick={install}>
                {t.common.retry}
              </button>
            </>
          )}
          {phase === "failed" && (
            <>
              <p className="error">{t.update.installFailed(error ?? "")}</p>
              <button className="primary-button" onClick={() => relaunch()}>
                {t.update.restart}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
