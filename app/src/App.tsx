import { useState } from "react";
import BatchView from "./BatchView";
import SingleView from "./SingleView";
import { UpdateButton } from "./UpdateButton";

type Mode = "single" | "batch";

/** Both views stay mounted (one hidden): switching never loses what's in
 * the other. */
export default function App() {
  const [mode, setMode] = useState<Mode>("single");
  const modeSwitch = (
    <div className="sidebar-top">
      <div className="segmented mode-switch">
        <button className={mode === "single" ? "active" : ""} onClick={() => setMode("single")}>
          Un fichier
        </button>
        <button className={mode === "batch" ? "active" : ""} onClick={() => setMode("batch")}>
          Série
        </button>
      </div>
      <UpdateButton />
    </div>
  );
  return (
    <div className="app">
      <SingleView modeSwitch={modeSwitch} active={mode === "single"} />
      <BatchView modeSwitch={modeSwitch} active={mode === "batch"} />
    </div>
  );
}
