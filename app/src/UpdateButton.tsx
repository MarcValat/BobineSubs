import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { errorMessage } from "./shared";
import "./UpdateButton.css";

// "error": the download failed, the app still works; "failed": the install
// did, after the engine was stopped.
type Phase = "idle" | "available" | "downloading" | "ready" | "error" | "failed";

interface PendingUpdate {
  version: string;
  download(onEvent: (event: DownloadEvent) => void): Promise<void>;
  install(): Promise<void>;
}
type DownloadEvent =
  | { event: "Started"; data: { contentLength?: number } }
  | { event: "Progress"; data: { chunkLength: number } }
  | { event: "Finished" };

/** Dev only: `?update=1` shows a pretend update. */
function devUpdate(): PendingUpdate | null {
  if (!import.meta.env.DEV || new URLSearchParams(location.search).get("update") !== "1") return null;
  return { version: "9.9.9", download: () => Promise.reject(new Error("mise à jour fictive (dev)")), install: () => Promise.resolve() };
}

// One check per launch, shared: the button is shown in both views' sidebars.
let checked: Promise<PendingUpdate | null> | null = null;
const checkOnce = () => (checked ??= check());

/**
 * From SyncAudio: asks GitHub Releases once at startup (tauri.conf.json's
 * plugins.updater.endpoints) and, when a newer signed build exists, shows
 * an icon whose menu installs it in place. Silent on failure (no network...):
 * an optional background check must never get in the way.
 */
export function UpdateButton() {
  const [update, setUpdate] = useState<PendingUpdate | null>(devUpdate);
  const [phase, setPhase] = useState<Phase>(() => (devUpdate() ? "available" : "idle"));
  const [progress, setProgress] = useState<{ downloaded: number; total: number | null }>({ downloaded: 0, total: null });
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (devUpdate() || !isTauri()) return;
    let cancelled = false;
    checkOnce()
      .then((result) => {
        if (!cancelled && result) {
          setUpdate(result);
          setPhase("available");
        }
      })
      .catch(() => {
        // Deliberately silent, see above.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => !boxRef.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
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
    // leaves the app fully usable, and it can be retried.
    try {
      await update.download((event) => {
        if (event.event === "Started") setProgress({ downloaded: 0, total: event.data.contentLength ?? null });
        else if (event.event === "Progress") setProgress((p) => ({ downloaded: p.downloaded + event.data.chunkLength, total: p.total }));
      });
    } catch (err) {
      setPhase("error");
      setError(errorMessage(err));
      return;
    }
    setPhase("ready");
    try {
      // The installer can't replace the engine's exe while it runs: stopped
      // only now, right before installing (see lib.rs's stop_sidecar).
      await invoke("stop_sidecar");
      await update.install();
      await relaunch();
    } catch (err) {
      // The engine is stopped by now: only a restart brings it back.
      setPhase("failed");
      setError(errorMessage(err));
    }
  }

  if (phase === "idle" || !update) return null;

  const percent = progress.total ? Math.round((progress.downloaded / progress.total) * 100) : null;
  const busy = phase === "downloading" || phase === "ready";
  const failed = phase === "error" || phase === "failed";
  const title =
    phase === "downloading"
      ? `Téléchargement de la mise à jour${percent !== null ? ` : ${percent} %` : "…"}`
      : failed
        ? "La mise à jour a échoué"
        : `Version ${update.version} disponible`;

  return (
    <div className="update-box" ref={boxRef}>
      <button
        className={`update-button${failed ? " failed" : ""}${busy ? " busy" : ""}`}
        title={title}
        aria-label={title}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path d="M12 3v12m0 0-5-5m5 5 5-5M5 20h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="update-dot" aria-hidden="true" />
      </button>
      {open && (
        <div className="update-menu" role="dialog">
          <p className="update-menu-title">{failed ? "La mise à jour a échoué" : `Bobine Subs ${update.version} est disponible`}</p>
          {phase === "available" && (
            <>
              <p className="muted">L'application redémarrera une fois la mise à jour installée.</p>
              <button className="primary" onClick={install}>
                Installer la mise à jour
              </button>
            </>
          )}
          {phase === "downloading" && <p>Téléchargement…{percent !== null && ` ${percent} %`}</p>}
          {phase === "ready" && <p>Installation…</p>}
          {phase === "error" && (
            <>
              <p className="error">Le téléchargement a échoué : {error}</p>
              <button className="primary" onClick={install}>
                Réessayer
              </button>
            </>
          )}
          {phase === "failed" && (
            <>
              <p className="error">L'installation a échoué : {error}</p>
              <button className="primary" onClick={() => relaunch()}>
                Redémarrer l'application
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
