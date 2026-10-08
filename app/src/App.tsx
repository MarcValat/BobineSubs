import { useCallback, useLayoutEffect, useRef, useState } from "react";
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
          {/* Batch, and its sub-modes in a drawer that unrolls from under it
              (folded away, and out of the tab order, outside Batch). */}
          <div className={`batch-group${batch ? " open" : ""}`}>
            <button className={batch ? "primary-button batch-main-button" : "batch-main-button"} onClick={() => setMode("batch")} aria-expanded={batch}>
              Batch
            </button>
            <div className="batch-drawer" inert={!batch}>
              <div className="batch-drawer-clip">
                <SubModes kind={kind} busy={batchBusy} onChange={chooseKind} />
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

const SUB_MODES: [Kind, string][] = [
  ["multi", "Fichiers multipistes"],
  ["pairs", "Paires de fichiers"],
];

/** Batch's two sub-modes, a selection pill sliding under the picked one. */
function SubModes({ kind, busy, onChange }: { kind: Kind; busy: boolean; onChange: (kind: Kind) => void }) {
  const buttons = useRef<Partial<Record<Kind, HTMLButtonElement | null>>>({});
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);
  // No slide for the first placement: the pill just starts there.
  const [placed, setPlaced] = useState(false);

  useLayoutEffect(() => {
    const button = buttons.current[kind];
    if (!button) return;
    setPill({ left: button.offsetLeft, width: button.offsetWidth });
  }, [kind]);
  useLayoutEffect(() => {
    if (pill && !placed) requestAnimationFrame(() => setPlaced(true));
  }, [pill, placed]);

  return (
    <div className="batch-submodes" role="tablist" aria-label="Mode batch">
      {pill && <span className={`batch-submodes-pill${placed ? " placed" : ""}`} style={{ left: pill.left, width: pill.width }} />}
      {SUB_MODES.map(([value, label]) => (
        <button
          key={value}
          ref={(el) => {
            buttons.current[value] = el;
          }}
          role="tab"
          aria-selected={kind === value}
          className={kind === value ? "active" : ""}
          onClick={() => onChange(value)}
          disabled={busy && kind !== value}
          title={busy && kind !== value ? "Un traitement est en cours : attends sa fin." : undefined}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
