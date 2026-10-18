import { useEffect, useState } from "react";
import { loadOutputDir, saveOutputDir } from "./batchShared";
import { MultiTrackBatch } from "./MultiTrackBatch";
import { PairsBatch } from "./PairsBatch";
import type { BatchMode } from "./Workspace";
import "./BatchView.css";

/** The workspace: one file or a whole series in one pass, in either of two
 * ways -- files that each hold the reference and the tracks to correct
 * ("Fichiers multipistes"), or pairs of files where the track to correct
 * comes from another file ("Paires de fichiers"). Both stay mounted (the
 * other one just hidden), so switching between them keeps each one's files
 * and results; the output folder is shared and remembered across sessions.
 * The mode is picked in the top bar (App.tsx), told when one is busy, or
 * on the empty workspace's mode cards (`onModeChange`, absent while busy).
 * From Bobine Audio. */
export function BatchView({
  mode,
  onModeChange,
  onBusyChange,
}: {
  mode: BatchMode;
  onModeChange?: (mode: BatchMode) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [outputDir, setOutputDir] = useState<string | null>(loadOutputDir);
  // Which mode is analyzing or exporting: only one runs at a time.
  const [busy, setBusy] = useState<Record<BatchMode, boolean>>({ multi: false, pairs: false });

  useEffect(() => onBusyChange(busy.multi || busy.pairs), [busy, onBusyChange]);

  function changeOutputDir(dir: string | null) {
    setOutputDir(dir);
    saveOutputDir(dir);
  }

  return (
    <>
      <MultiTrackBatch
        hidden={mode !== "multi"}
        onModeChange={onModeChange}
        outputDir={outputDir}
        onOutputDirChange={changeOutputDir}
        blocked={busy.pairs}
        onBusyChange={(b) => setBusy((c) => (c.multi === b ? c : { ...c, multi: b }))}
      />
      <PairsBatch
        hidden={mode !== "pairs"}
        onModeChange={onModeChange}
        outputDir={outputDir}
        onOutputDirChange={changeOutputDir}
        blocked={busy.multi}
        onBusyChange={(b) => setBusy((c) => (c.pairs === b ? c : { ...c, pairs: b }))}
      />
    </>
  );
}
