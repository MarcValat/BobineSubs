import { useRef, useState, type ReactNode } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { cancelJob, planOutputs, type Analysis, type RenderResponse, type TrackRef } from "./api";
import { JobCancelled, runJob, type RunStatus } from "./jobs";
import { FolderIcon } from "./icons";
import { Tooltip } from "./InfoTip";
import { pickFolder } from "./shared";
import { errorMessage, loadSetting, saveSetting } from "./util";
import { t, useT } from "./i18n";

export function moved<T>(arr: T[], from: number, to: number): T[] {
  if (to < 0 || to >= arr.length) return arr;
  const copy = [...arr];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

/** What the gradient button does next (one in the window): analyze while
 * something isn't analyzed (or is being), then export what's analyzed and
 * not exported yet; nothing once all is done. */
type NextStep = "analyze" | "export" | null;

export function nextStep({
  analyzing,
  missing,
  exportable,
  exported,
}: {
  analyzing: boolean;
  /** Not analyzed yet, or failed. */
  missing: number;
  /** Has something analyzed to export. */
  exportable: number;
  exported: number;
}): NextStep {
  if (analyzing || missing > 0) return "analyze";
  return exportable > exported ? "export" : null;
}

/** A batch's analyze button: the items (tracks, pairs) not analyzed yet
 * when there are, keeping the others and their edits -- with a way to redo
 * everything -- or everything again once all are done. */
export function AnalyzeButton({
  analyzing,
  reading,
  missing,
  analyzed,
  unit,
  primary,
  disabled,
  blocked,
  onAnalyze,
}: {
  analyzing: boolean;
  /** Files of the list still being read: analyzing all waits for them
   * (it would leave them out). */
  reading: boolean;
  missing: number;
  analyzed: number;
  /** What's counted. */
  unit: "track" | "pair";
  /** It's the window's next step (see nextStep): the gradient. */
  primary: boolean;
  disabled: boolean;
  blocked: boolean;
  onAnalyze: (all: boolean) => void;
}) {
  const t = useT();
  const blockedTitle = blocked ? t.batch.otherModeBusy : undefined;
  const redoTitle = t.batch.reanalyzeHint;
  if (analyzing || reading) {
    return (
      <button className={primary ? "primary-button" : ""} disabled>
        {analyzing ? t.common.analysisRunning : t.batch.readingTracks}
      </button>
    );
  }
  if (missing === 0 && analyzed > 0) {
    // Nothing left to analyze: redoing it all isn't the next step (exporting
    // is), so it's a plain button.
    return (
      <button disabled={disabled} title={blockedTitle ?? redoTitle} onClick={() => onAnalyze(true)}>
        {t.batch.reanalyzeAll}
      </button>
    );
  }
  return (
    <>
      {analyzed > 0 && (
        // As tall as the buttons beside it.
        <button disabled={disabled} title={blockedTitle ?? redoTitle} onClick={() => onAnalyze(true)}>
          {t.batch.reanalyzeAll}
        </button>
      )}
      <button
        className={primary ? "primary-button" : ""}
        disabled={disabled}
        title={blockedTitle ?? (analyzed > 0 ? t.batch.analyzeRestHint(unit) : undefined)}
        onClick={() => onAnalyze(false)}
      >
        {analyzed > 0 ? t.batch.analyzeRest(missing, unit) : t.batch.analyzeAll}
      </button>
    </>
  );
}

/** Why files can't be dropped on a batch mode right now, if they can't:
 * like its "+ Ajouter" buttons, not while it or the other mode works. */
export function dropBlockedReason(busy: boolean, blocked: boolean): string | null {
  if (busy) return t().batch.dropBusy;
  return blocked ? t().batch.otherModeBusy : null;
}

const OUTPUT_DIR_KEY = "syncsubtitles.batchOutputDir";

/** The folder batch exports go to (null: next to each original), kept for the next session. */
export const loadOutputDir = (): string | null => loadSetting(OUTPUT_DIR_KEY);
export const saveOutputDir = (dir: string | null): void => saveSetting(OUTPUT_DIR_KEY, dir);

/** One analysis, as both batch modes keep it (a corrected track of a file, a pair). */
export interface AnalysisRun {
  status: RunStatus;
  result: Analysis | null;
  error: string | null;
  log: string[];
  /** Its segments were changed by hand ("Modifier les segments"). */
  edited?: boolean;
}

/** Where a row stands, for the colored bar at its left (as Bobine Subs'
 * rows): something running, waiting,
 * failed or flagged, exported, every analysis done, or nothing done yet. A
 * row holds one analysis (a pair) or several (a file's corrected tracks). */
export function rowState(analyses: (AnalysisRun | undefined)[], exportStatus: RunStatus | undefined, problem: boolean): string {
  const statuses = analyses.map((a) => a?.status);
  if (statuses.includes("running") || exportStatus === "running") return "running";
  if (statuses.includes("pending")) return "queued";
  if (problem || statuses.includes("error") || exportStatus === "error") return "error";
  if (exportStatus === "done") return "exported";
  if (statuses.length > 0 && statuses.every((s) => s === "done")) return "analyzed";
  return "idle";
}

/** One file's export, as both batch modes keep it. */
export interface ExportFields {
  exportStatus: RunStatus;
  exportResult: RenderResponse | null;
  exportError: string | null;
  exportLog: string[];
}

export const IDLE_EXPORT: ExportFields = { exportStatus: "idle", exportResult: null, exportError: null, exportLog: [] };

/** The file an export wrote, once done (a subtitles-only export of
 * several tracks: the first of its files). */
export const writtenFile = (entry: ExportFields | undefined | null): string | undefined => entry?.exportResult?.path;

/** The row's folder icon, once its export is written (as in Bobine Subs). */
export function RevealButton({ file }: { file: string | undefined }) {
  const t = useT();
  if (!file) return null;
  return (
    <Tooltip text={t.batch.folderHint}>
      <button className="small-button icon-small-button" aria-label={t.batch.folderHint} onClick={() => revealItemInDir(file)}>
        <FolderIcon />
      </button>
    </Tooltip>
  );
}

/** One file to export: `items` name its outputs (see planOutputs: one per
 * corrected track in a subtitles-only export, one for the new MKV
 * otherwise), `start` starts its render job at those output paths,
 * `update` records its progress in the mode's own state. */
interface ExportTask {
  items: [TrackRef, TrackRef][];
  start: (outputPaths: string[]) => Promise<string>;
  update: (patch: (entry: ExportFields) => Partial<ExportFields>) => void;
}

/** "Exporter tout" / "Annuler l'export", the same in both batch modes: the
 * output names are decided up front, then one render at a time; cancelling
 * stops the one running (the engine kills it and removes its half-written
 * file) and doesn't start the next ones. */
export function useExportQueue(outputDir: string | null, subsOnly: boolean) {
  const [exporting, setExporting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const cancelRequested = useRef(false);
  const currentJob = useRef<string | null>(null);

  async function run(tasks: ExportTask[]) {
    setExporting(true);
    cancelRequested.current = false;
    try {
      // Decided together: two exports never get the same name.
      let outputs: string[][];
      try {
        const all = await planOutputs(
          tasks.flatMap((t) => t.items),
          subsOnly,
          outputDir,
        );
        let at = 0;
        outputs = tasks.map((t) => all.slice(at, (at += t.items.length)));
      } catch (err) {
        const message = errorMessage(err);
        for (const t of tasks) t.update(() => ({ exportStatus: "error", exportError: message }));
        return;
      }
      for (const [k, task] of tasks.entries()) {
        if (cancelRequested.current) break;
        task.update(() => ({ exportStatus: "running", exportLog: [], exportError: null }));
        try {
          const result = await runJob<RenderResponse>(
            task.start(outputs[k]),
            (message) => task.update((e) => ({ exportLog: [...e.exportLog, message] })),
            (id) => (currentJob.current = id),
          );
          task.update(() => ({ exportStatus: "done", exportResult: result }));
        } catch (err) {
          if (err instanceof JobCancelled) task.update(() => ({ exportStatus: "cancelled" }));
          else task.update(() => ({ exportStatus: "error", exportError: errorMessage(err) }));
        }
        currentJob.current = null;
      }
    } finally {
      setExporting(false);
      setCancelling(false);
    }
  }

  async function cancel() {
    cancelRequested.current = true;
    setCancelling(true);
    if (currentJob.current) {
      try {
        await cancelJob(currentJob.current);
      } catch {
        // already over: the queue stops before the next file anyway
      }
    }
  }

  return { exporting, cancelling, run, cancel };
}

/** "Sortie :" in a mode's footer: next to the originals, or a folder
 * (until the export options' dialog). */
function OutputChooser({
  outputDir,
  onOutputDirChange,
  disabled,
}: {
  outputDir: string | null;
  onOutputDirChange: (dir: string | null) => void;
  disabled: boolean;
}) {
  const t = useT();
  return (
    <div className="batch-output">
      <span className="batch-output-label">{t.batch.output}</span>
      <span className={outputDir ? "batch-output-dir batch-output-path" : "batch-output-dir"} title={outputDir ?? undefined}>
        {outputDir ?? t.batch.nextToOriginals}
      </span>
      <button
        className="small-button"
        disabled={disabled}
        title={t.batch.chooseFolderHint}
        onClick={async () => {
          const dir = await pickFolder(t.batch.outputFolder);
          if (dir) onOutputDirChange(dir);
        }}
      >
        {t.batch.chooseFolder}
      </button>
      {outputDir && (
        <button
          className="small-button"
          disabled={disabled}
          onClick={() => onOutputDirChange(null)}
          title={t.batch.backNextToOriginalsHint}
        >
          {t.batch.backNextToOriginals}
        </button>
      )}
    </div>
  );
}

/** A mode's footer: output folder, progress line, analyze and export (or
 * cancel) buttons, the export the gradient when it's the next step
 * (`exportNext`). */
export function BatchFooter({
  outputDir,
  onOutputDirChange,
  busy,
  blocked,
  progress,
  analyzeButton,
  queue,
  canExport,
  exportNext,
  onExport,
}: {
  outputDir: string | null;
  onOutputDirChange: (dir: string | null) => void;
  busy: boolean;
  blocked: boolean;
  progress: ReactNode;
  analyzeButton: ReactNode;
  queue: ReturnType<typeof useExportQueue>;
  canExport: boolean;
  exportNext: boolean;
  onExport: () => void;
}) {
  const t = useT();
  return (
    <div className="batch-footer panel">
      <OutputChooser outputDir={outputDir} onOutputDirChange={onOutputDirChange} disabled={busy} />
      <span className="batch-progress">{progress}</span>
      {analyzeButton}
      {queue.exporting ? (
        <button className="export-cancel" onClick={queue.cancel} disabled={queue.cancelling}>
          {queue.cancelling ? t.common.cancelling : t.common.cancelExport}
        </button>
      ) : (
        <button
          className={exportNext ? "primary-button" : ""}
          onClick={onExport}
          disabled={!canExport || busy || blocked}
          title={blocked ? t.batch.otherModeBusy : undefined}
        >
          {t.batch.exportAll}
        </button>
      )}
    </div>
  );
}
