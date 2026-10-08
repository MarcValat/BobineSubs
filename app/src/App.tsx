import { useState } from "react";
import BatchView from "./BatchView";
import SingleView from "./SingleView";
import { EngineStatusBadge } from "./EngineStatus";
import { OptionsButton } from "./Options";
import { UpdateButton } from "./UpdateButton";

type Mode = "single" | "batch";

/** The top bar as in Bobine Audio: the mode on the left, the engine's
 * state, the update and Options on the right. Both views stay mounted (one
 * hidden): switching never loses what's in the other. */
export default function App() {
  const [mode, setMode] = useState<Mode>("single");
  return (
    <div className="app">
      <div className="top-bar">
        <div className="mode-switch">
          <button className={mode === "single" ? "primary" : ""} onClick={() => setMode("single")}>
            Un fichier
          </button>
          <button className={mode === "batch" ? "primary" : ""} onClick={() => setMode("batch")}>
            Série
          </button>
        </div>
        <div className="top-actions">
          <EngineStatusBadge />
          <UpdateButton />
          <OptionsButton />
        </div>
      </div>
      <SingleView active={mode === "single"} />
      <BatchView active={mode === "batch"} />
    </div>
  );
}
