import { retryEngine, useEngineStatus } from "./engine";
import { useT } from "./i18n";

/** The engine's startup, top right: a small spinner while it starts, the
 * failure and "Réessayer" if it never answers, nothing once it's up. The
 * rest of the UI stays usable meanwhile (see engineReady). */
export function EngineStatusBadge() {
  const status = useEngineStatus();
  const t = useT();
  if (status === "ready") return null;
  if (status === "starting") {
    return (
      <span className="engine-status" role="status">
        <span className="spinner spinner-small" aria-hidden="true" />
        {t.startup.starting}
      </span>
    );
  }
  return (
    <span className="engine-status engine-status-error" role="alert" title={t.startup.unreachable}>
      ⚠ {t.startup.unreachableShort}
      <button className="small-button" onClick={retryEngine}>
        {t.common.retry}
      </button>
    </span>
  );
}
