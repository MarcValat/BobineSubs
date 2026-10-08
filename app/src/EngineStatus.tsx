import { retryEngine, useEngineStatus } from "./engine";

/** The engine's startup, top right: a small spinner while it starts, the
 * failure and "Réessayer" if it never answers, nothing once it's up. The
 * rest of the UI stays usable meanwhile (see engineReady). */
export function EngineStatusBadge() {
  const status = useEngineStatus();
  if (status === "ready") return null;
  if (status === "starting") {
    return (
      <span className="engine-status" role="status">
        <span className="spinner spinner-small" aria-hidden="true" />
        Démarrage du moteur...
      </span>
    );
  }
  return (
    <span className="engine-status engine-status-error" role="alert" title="Le moteur d'analyse ne répond pas. Réessaie, ou redémarre l'application.">
      ⚠ Le moteur ne répond pas
      <button className="small-button" onClick={retryEngine}>
        Réessayer
      </button>
    </span>
  );
}
