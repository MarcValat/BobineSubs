import { useCallback, useState } from "react";
import BatchView, { type Kind } from "./BatchView";
import SingleView from "./SingleView";
import { EngineStatusBadge } from "./EngineStatus";
import { OptionsButton } from "./Options";
import { loadSetting, saveSetting } from "./settings";
import { UpdateButton } from "./UpdateButton";

type Mode = "single" | "batch";

const BATCH_KIND_KEY = "syncsubtitles.batchMode";

/** The top bar as in Bobine Audio: the mode on the left, the engine's
 * state, the update and Options on the right. Batch unfolds to its right
 * into its two sub-modes, the last one used picked. Both views stay
 * mounted (one hidden): switching never loses what's in the other. */
export default function App() {
  const [mode, setMode] = useState<Mode>("single");
  const [kind, setKind] = useState<Kind>(() => (loadSetting(BATCH_KIND_KEY) === "pairs" ? "pairs" : "multi"));
  const [batchBusy, setBatchBusy] = useState(false);
  const chooseKind = useCallback((next: Kind) => {
    setKind(next);
    saveSetting(BATCH_KIND_KEY, next === "multi" ? null : next);
  }, []);
  const batch = mode === "batch";

  return (
    <div className="container">
      <div className="top-bar">
        <div className="mode-switch">
          <button className={mode === "single" ? "primary-button" : ""} onClick={() => setMode("single")}>
            Fichier unique
          </button>
          {/* One pill: Batch, then its sub-modes coming out of it (folded
              away, and out of the tab order, outside Batch). */}
          <div className={`batch-pill${batch ? " open" : ""}`}>
            <button className="batch-pill-main" onClick={() => setMode("batch")} aria-expanded={batch}>
              Batch
            </button>
            <div className="batch-submodes" inert={!batch}>
              <div className="batch-submodes-inner" role="tablist" aria-label="Mode batch">
                {(
                  [
                    ["multi", "Fichiers multipistes"],
                    ["pairs", "Paires de fichiers"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    role="tab"
                    aria-selected={kind === value}
                    className={kind === value ? "active" : ""}
                    onClick={() => chooseKind(value)}
                    disabled={batchBusy && kind !== value}
                    title={batchBusy && kind !== value ? "Un traitement est en cours : attends sa fin." : undefined}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="top-actions">
          <EngineStatusBadge />
          <UpdateButton />
          <OptionsButton />
        </div>
      </div>
      <SingleView active={mode === "single"} />
      <BatchView active={batch} kind={kind} onKindChange={chooseKind} onBusyChange={setBatchBusy} />
    </div>
  );
}
