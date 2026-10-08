import { useCallback, useState } from "react";
import BatchView, { type Kind } from "./BatchView";
import SingleView from "./SingleView";
import { EngineStatusBadge } from "./EngineStatus";
import { OptionsButton } from "./Options";
import { PillSwitch } from "./PillSwitch";
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
          {/* Batch, and its sub-modes in a drawer that unrolls from under it
              (folded away, and out of the tab order, outside Batch). */}
          <div className={`batch-group${batch ? " open" : ""}`}>
            <button className={batch ? "primary-button batch-main-button" : "batch-main-button"} onClick={() => setMode("batch")} aria-expanded={batch}>
              Batch
            </button>
            <div className="batch-drawer" inert={!batch}>
              <div className="batch-drawer-clip">
                <PillSwitch
                  className="batch-submodes"
                  label="Mode batch"
                  options={[
                    ["multi", "Fichiers multipistes"],
                    ["pairs", "Paires de fichiers"],
                  ]}
                  value={kind}
                  onChange={chooseKind}
                  disabled={batchBusy}
                  disabledTitle="Un traitement est en cours : attends sa fin."
                />
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

