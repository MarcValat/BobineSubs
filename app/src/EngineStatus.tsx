import { retryEngine, useEngineStatus } from "./engine";
import { useT } from "./i18n";
import { WarningIcon } from "./icons";

/** The engine's state, top right, as a pill (as the mockup): "Moteur prêt"
 * with a green dot once it's up, a small spinner while it starts, the
 * failure and "Réessayer" if it never answers. The rest of the UI stays
 * usable meanwhile (see engineReady). */
export function EngineStatusBadge() {
  const t = useT();
  const status = useEngineStatus();
  if (status === "ready") {
    return (
      <span className="engine-status engine-status-ready" role="status">
        <span className="engine-status-dot" aria-hidden="true" />
        {t.startup.ready}
      </span>
    );
  }
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
      <WarningIcon />
      {t.startup.unreachableShort}
      <button className="small-button" onClick={retryEngine}>
        {t.common.retry}
      </button>
    </span>
  );
}
