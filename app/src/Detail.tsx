import type { ReactNode } from "react";
import { nextStep, RevealButton, writtenFile, type AnalysisRun, type ExportFields } from "./batchShared";
import { useT } from "./i18n";
import { RedoIcon } from "./icons";
import { InfoTip, Tooltip } from "./InfoTip";
import { LogPanel } from "./LogPanel";
import { basename } from "./paths";
import { PillSwitch } from "./PillSwitch";

/** The parts of a list item's detail (Workspace.css), shared by both batch
 * modes: a multitrack file's and a pair's are laid out alike -- a header
 * with the item's next step, a tab per corrected track, its tracks beside
 * what its analysis found, how its export went. From Bobine Audio. */

/** The detail's title row: the item's name and what it is, then its
 * buttons -- "Réanalyser" (the shown track alone), "Modifier les segments",
 * and its next step -- "Analyser" while some of its tracks aren't
 * analyzed, then its export -- as the gradient button when the item holds
 * the window's next step (`primary`: it's alone in the list; with several,
 * the footer's buttons do). */
export function DetailHeader({
  title,
  titleTooltip,
  meta,
  onReanalyze,
  onEdit,
  editDisabled,
  missing,
  analyzing,
  done,
  exported,
  primary,
  disabled,
  analyzeDisabled = false,
  blockedTitle,
  analyzeTitle,
  exportLabel,
  onAnalyze,
  onExport,
}: {
  title: ReactNode;
  titleTooltip?: string;
  meta?: ReactNode;
  /** The shown track's analysis is over (done or failed): it can be redone. */
  onReanalyze?: () => void;
  /** The shown track is analyzed: its segments can be edited. */
  onEdit?: () => void;
  editDisabled: boolean;
  /** Tracks not analyzed yet (or failed), being analyzed, analyzed. */
  missing: number;
  analyzing: boolean;
  done: number;
  /** Its export is written (and still what it would write). */
  exported: boolean;
  primary: boolean;
  /** Something runs (here or in the other mode): nothing starts. */
  disabled: boolean;
  /** Nothing to analyze it with (no reference, a file that can't be read). */
  analyzeDisabled?: boolean;
  /** Why it's disabled, when it's the other mode working. */
  blockedTitle?: string;
  analyzeTitle: string;
  exportLabel: string;
  onAnalyze: () => void;
  onExport: () => void;
}) {
  const t = useT();
  const next = primary ? nextStep({ analyzing, missing, exportable: done > 0 ? 1 : 0, exported: exported ? 1 : 0 }) : null;
  return (
    <div className="detail-header">
      <div className="detail-title">
        <span className="detail-name" title={titleTooltip}>
          {title}
        </span>
        {meta && (
          <span className="detail-meta" title={typeof meta === "string" ? meta : undefined}>
            {meta}
          </span>
        )}
      </div>
      {onReanalyze && (
        <Tooltip text={t.batch.reanalyzeOneHint}>
          <button
            className="icon-small-button detail-icon-button"
            disabled={disabled}
            onClick={onReanalyze}
            aria-label={t.batch.reanalyzeOne}
          >
            <RedoIcon />
          </button>
        </Tooltip>
      )}
      {onEdit && (
        <button disabled={editDisabled} onClick={onEdit}>
          {t.common.editSegments}
        </button>
      )}
      {(missing > 0 || analyzing) && (
        <button
          className={next === "analyze" ? "primary-button" : ""}
          disabled={analyzing || disabled || analyzeDisabled}
          title={blockedTitle ?? analyzeTitle}
          onClick={onAnalyze}
        >
          {analyzing ? t.common.analysisRunning : t.multi.analyzeFile}
        </button>
      )}
      {done > 0 && (
        <button className={next === "export" ? "primary-button" : ""} disabled={disabled} title={blockedTitle} onClick={onExport}>
          {exportLabel}
        </button>
      )}
    </div>
  );
}

/** The row above the tracks and the analysis: one tab per corrected track. */
export function DetailTabs({
  tracks,
  value,
  onChange,
}: {
  tracks: readonly (readonly [string, string])[];
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useT();
  return (
    <div className="detail-tabs">
      <PillSwitch className="detail-track-tabs" label={t.multi.shownTrack} options={tracks} value={value} onChange={onChange} />
    </div>
  );
}

/** "PISTES ?" over the tracks table, and "(manuel)" with the button back
 * to the top bar's pick (`reset`) once they were picked by hand. */
export function TracksHeading({
  hint,
  reset,
}: {
  hint: string;
  reset?: { label: string; title: string; disabled: boolean; onClick: () => void };
}) {
  const t = useT();
  return (
    <div className="detail-heading">
      <h3>
        {t.multi.tracks} <InfoTip>{hint}</InfoTip>
      </h3>
      {reset && <span className="list-row-manual">{t.multi.manual}</span>}
      {reset && (
        <button className="small-button" disabled={reset.disabled} title={reset.title} onClick={reset.onClick}>
          {reset.label}
        </button>
      )}
    </div>
  );
}

/** "SEGMENTS" and its summary over what the shown track's analysis found
 * (`children`) -- or, before there's one, its frame saying what's going on
 * (nothing to correct, not analyzed, waiting, running, failed, with its
 * log). */
export function DetailChart({
  summary,
  run,
  noTrack,
  children,
}: {
  summary: ReactNode;
  run: AnalysisRun | undefined;
  /** Set when there's no track to correct: why. */
  noTrack: string | null;
  /** What the analysis found, once it's done. */
  children?: ReactNode;
}) {
  const t = useT();
  return (
    <div className="detail-chart">
      <div className="detail-heading">
        <h3>{t.common.segments}</h3>
        <span className="detail-heading-summary">{summary}</span>
      </div>
      {children ?? (
        // Its room kept while there's nothing to show yet.
        <div className="detail-placeholder">
          {noTrack && <p className="placeholder">{noTrack}</p>}
          {!noTrack && !run && <p className="placeholder">{t.multi.notAnalyzed}</p>}
          {run?.status === "pending" && <p className="placeholder">{t.batch.pending}</p>}
          {run?.status === "running" && (
            <p className="placeholder detail-running">
              <span className="spinner spinner-small" />
              {t.common.analysisRunning}
            </p>
          )}
          {run?.status === "error" && <p className="error">{run.error ?? t.common.error}</p>}
          <LogPanel lines={run?.log ?? []} />
        </div>
      )}
    </div>
  );
}

/** Under a detail: how its export went (running, the file written with its
 * folder, the error, cancelled), with its log. Nothing before an export. */
export function DetailExport({ entry }: { entry: ExportFields | null | undefined }) {
  const t = useT();
  if (!entry || entry.exportStatus === "idle") return null;
  const written = writtenFile(entry);
  const count = entry.exportResult?.tracks.length ?? 0;
  return (
    <div className={`detail-export batch-status-${entry.exportStatus}`}>
      {entry.exportStatus === "running" && t.common.exportRunning}
      {entry.exportStatus === "done" && written && (
        <span className="render-success" title={entry.exportResult?.tracks.map((w) => w.path).join("\n")}>
          {entry.exportResult?.kind === "subtitles" && count > 1 ? t.common.writtenMany(count) : t.common.written(basename(written))}
        </span>
      )}
      {entry.exportStatus === "error" && (entry.exportError ?? t.common.error)}
      {entry.exportStatus === "cancelled" && t.common.exportCancelled}
      <RevealButton file={written} />
      <LogPanel lines={entry.exportLog} />
    </div>
  );
}
