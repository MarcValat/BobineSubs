import { useSyncExternalStore } from "react";

/** The engine sidecar's local address (see src-tauri/src/lib.rs). */
export const ENGINE_URL = "http://127.0.0.1:8757";

const HEALTH_POLL_INTERVAL_MS = 100;
const HEALTH_POLL_ATTEMPTS = 300; // 30 s before giving up

/** "starting": not answering yet; "unreachable": gave up waiting (see retryEngine). */
export type EngineStatus = "starting" | "ready" | "unreachable";

let status: EngineStatus = "starting";
let ready: Promise<void> | null = null;
const listeners = new Set<() => void>();

function setStatus(next: EngineStatus): void {
  status = next;
  listeners.forEach((listener) => listener());
}

async function healthy(): Promise<boolean> {
  try {
    return (await fetch(`${ENGINE_URL}/health`)).ok;
  } catch {
    return false;
  }
}

function waitForEngine(): Promise<void> {
  setStatus("starting");
  const attempt = new Promise<void>((resolve, reject) => {
    let attempts = 0;
    const poll = async () => {
      if (await healthy()) {
        setStatus("ready");
        resolve();
      } else if (++attempts >= HEALTH_POLL_ATTEMPTS) {
        setStatus("unreachable");
        reject(new Error("Le moteur ne répond pas."));
      } else {
        setTimeout(poll, HEALTH_POLL_INTERVAL_MS);
      }
    };
    poll();
  });
  attempt.catch(() => {}); // only the requests waiting on it report it
  return attempt;
}

/** Resolves once the engine answers; every request waits on it, so the UI
 * is usable while the engine starts. */
export function engineReady(): Promise<void> {
  ready ??= waitForEngine();
  return ready;
}

export function retryEngine(): void {
  if (status === "unreachable") ready = waitForEngine();
}

export function useEngineStatus(): EngineStatus {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => status,
  );
}
