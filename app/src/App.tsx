import { useCallback, useEffect, useState } from "react";
import { setEngineLanguage } from "./api";
import { BatchView } from "./BatchView";
import { EngineStatusBadge } from "./EngineStatus";
import { useLanguage, useT } from "./i18n";
import { OptionsButton } from "./Options";
import { PillSwitch } from "./PillSwitch";
import { devParam, loadSetting, saveSetting } from "./util";
import { UpdateButton } from "./UpdateButton";
import { WindowControls } from "./WindowControls";
import type { BatchMode } from "./Workspace";
// The app's own icon, the same as the window's and the installer's.
import logoUrl from "../src-tauri/icons/128x128.png";

// The mode last used, picked again next time.
const MODE_KEY = "syncsubtitles.batchMode";

/** The window: the top bar (the only navigation: the two modes, the
 * engine's state, updates, settings) over the workspace of the mode. One
 * file dropped works as well as a whole season. From Bobine Audio. */
export default function App() {
  const t = useT();
  // Dev only (see devParam): the mode of the files given by `?batchFiles=`.
  const [mode, setMode] = useState<BatchMode>(() =>
    devParam("batchFiles") ? "multi" : loadSetting(MODE_KEY) === "pairs" ? "pairs" : "multi",
  );
  // An analysis or export is running: the other mode waits.
  const [busy, setBusy] = useState(false);
  const chooseMode = useCallback((next: BatchMode) => {
    setMode(next);
    saveSetting(MODE_KEY, next === "multi" ? null : next);
  }, []);

  // The engine's messages (job logs, errors) in the UI's language whenever
  // it changes (engine.ts sends it once the engine is up).
  const language = useLanguage();
  useEffect(() => {
    setEngineLanguage(language).catch(() => {});
  }, [language]);

  return (
    <div className="container">
      {/* The window's title bar (no system one: see WindowControls): dragged
          by its free parts, where data-tauri-drag-region is -- the bar and
          the name, not their children's buttons. */}
      <div className="top-bar" data-tauri-drag-region>
        <span className="app-brand" data-tauri-drag-region>
          <img src={logoUrl} alt="" />
          Bobine Subs
        </span>
        <PillSwitch
          className="mode-switch"
          label={t.modes.label}
          options={[
            ["multi", t.batch.multiMode],
            ["pairs", t.batch.pairsMode],
          ]}
          value={mode}
          onChange={chooseMode}
          disabled={busy}
          disabledTitle={t.modes.busy}
        />
        <div className="top-actions">
          <EngineStatusBadge />
          <UpdateButton />
          <OptionsButton />
        </div>
        <WindowControls />
      </div>

      <BatchView mode={mode} onModeChange={busy ? undefined : chooseMode} onBusyChange={setBusy} />
    </div>
  );
}
