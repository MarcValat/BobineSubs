import { useState } from "react";
import { createPortal } from "react-dom";
import type { Analysis, CueEdits } from "./api";
import { Dialog, DialogHeader } from "./Dialog";
import { ConfidenceGauge } from "./ConfidenceGauge";
import { CueLoupe } from "./CueLoupe";
import { isDrift } from "./editing";
import { clock, offset } from "./format";
import { t, useT } from "./i18n";
import { WarningIcon } from "./icons";
import { editLine, lineFates, segmentFor, type LineFate } from "./retime";
import { describeSegments } from "./SegmentChart";
import { LOW_CONFIDENCE } from "./shared";
import type { TimeView } from "./timeView";

/** What an analysis found, in a few words: the drift, a hand edit, how
 * many lines on each side, those without a counterpart or left out of the
 * export (a button: their list, to keep them or put them back, `onEdits`),
 * what the export's cleanup will fix (`cleanup`: it's on), and its warnings. */
export function AnalysisSummary({
  analysis,
  edited = false,
  cleanup = false,
  onEdits,
}: {
  analysis: Analysis;
  /** The segments were changed by hand since the analysis. */
  edited?: boolean;
  cleanup?: boolean;
  /** Lines kept or taken out by hand, from the list of those left out. */
  onEdits?: (edits: CueEdits) => void;
}) {
  const t = useT();
  const m = t.analysis;
  const [listing, setListing] = useState(false);
  const fixes = Object.entries(analysis.cleanup ?? {}).filter(([kind, n]) => n > 0 && kind in t.cleanup.kinds);
  const orphans = analysis.target_cues.filter((c) => c.group < 0).length;
  const fates = lineFates(analysis);
  const dropped = fates.filter((f) => f.fate !== "kept").length;
  const kept = fates.length - dropped;
  return (
    <>
      <div className="analysis-summary">
        <span className="analysis-found">{summarize(analysis)}</span>
        {analysis.ratio_name && <span className="badge">{m.ratio(analysis.ratio_name)}</span>}
        {edited && <span className="badge edited">{m.edited}</span>}
        <span className="analysis-counts">
          {m.counts(analysis.reference_cues.length, analysis.target_cues.length)}
          {orphans > 0 && m.orphans(orphans)}
          {fates.length > 0 &&
            (onEdits ? (
              <button className="link-button warn-text" title={m.lines.hint} onClick={() => setListing(true)}>
                {m.dropped(dropped)}
                {kept > 0 && m.keptCount(kept)}
              </button>
            ) : (
              <span className="warn-text">
                {m.dropped(dropped)}
                {kept > 0 && m.keptCount(kept)}
              </span>
            ))}
        </span>
      </div>
      {/* At the page's root: inside the detail (a .panel), it took its look. */}
      {listing &&
        onEdits &&
        createPortal(<LinesDialog analysis={analysis} onEdits={onEdits} onClose={() => setListing(false)} />, document.body)}
      {cleanup && fixes.length > 0 && (
        <p className="analysis-cleanup" title={t.cleanup.hint}>
          {t.cleanup.summary(fixes.map(([kind, n]) => t.cleanup.kinds[kind as keyof typeof t.cleanup.kinds](n)).join(", "))}
        </p>
      )}
      {analysis.warnings.map((w) => (
        <p key={w} className="warning">
          <WarningIcon /> {w}
        </p>
      ))}
    </>
  );
}

/** The lines an export leaves out, and those kept by hand: when each
 * starts (in the file to correct), what it says, why; kept ("Garder"),
 * put back or no longer kept, one by one or all of a stretch's at once. */
function LinesDialog({ analysis, onEdits, onClose }: { analysis: Analysis; onEdits: (edits: CueEdits) => void; onClose: () => void }) {
  const t = useT();
  const m = t.analysis.lines;
  const fates = lineFates(analysis);
  const gaps = fates.filter((f) => f.fate === "gap").map((f) => f.index);
  const action = (index: number, fate: LineFate) => {
    if (fate === "start") return null;
    const [label, change] = fate === "gap" ? [m.keep, "keep" as const] : [fate === "kept" ? m.unkeep : m.restore, "reset" as const];
    return (
      <button className="small-button" onClick={() => onEdits(editLine(analysis.edits, index, change))}>
        {label}
      </button>
    );
  };
  return (
    <Dialog onClose={onClose} closeOnBackdrop className="lines-panel" labelledBy="lines-title">
      <DialogHeader id="lines-title" title={m.title} onClose={onClose}>
        {gaps.length > 1 && (
          <button
            className="small-button"
            onClick={() => onEdits({ keep: [...new Set([...(analysis.edits?.keep ?? []), ...gaps])], drop: analysis.edits?.drop ?? [] })}
          >
            {m.keepAll}
          </button>
        )}
      </DialogHeader>
      <p className="hint">{m.hint}</p>
      {fates.length === 0 ? (
        <p className="placeholder">{m.none}</p>
      ) : (
        <div className="tracks-table-wrap list-scroll lines-table-wrap">
          <table className="data-table segments-table lines-table">
            <thead>
              <tr>
                <th>{m.time}</th>
                <th>{m.text}</th>
                <th>{m.why}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {fates.map(({ index, fate }) => {
                const cue = analysis.target_cues[index];
                return (
                  <tr key={index} className={`line-${fate}`}>
                    <td>{clock(cue.start, 2)}</td>
                    <td className="line-text">{cue.text.split("\n").join(" / ")}</td>
                    <td title={fate === "start" ? m.startHint : undefined}>{m.fates[fate]}</td>
                    <td>{action(index, fate)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Dialog>
  );
}

/** The cue loupe and the segments' table of an analysis, under the chart
 * (the loupe's stretch, `view`, is the chart's frame). */
export default function AnalysisView({
  analysis,
  duration,
  view,
  onView,
}: {
  analysis: Analysis;
  duration: number;
  view: TimeView;
  onView: (view: TimeView) => void;
}) {
  const m = useT().analysis;
  const segments = analysis.segments;
  // By where each line falls now (hand edits move them between segments).
  const counts = segments.map((_, g) => analysis.target_cues.filter((c) => segmentFor((c.start + c.end) / 2, segments) === g).length);

  return (
    <div className="analysis-content">
      <CueLoupe analysis={analysis} duration={duration} view={view} onView={onView} />
      <div className="tracks-table-wrap">
        <table className="data-table segments-table">
          <thead>
            <tr>
              <th>#</th>
              <th>{m.start}</th>
              <th>{m.end}</th>
              <th>{m.offset}</th>
              <th>{m.cues}</th>
              <th>{m.confidence}</th>
            </tr>
          </thead>
          <tbody>
            {segments.map((s, i) => (
              <tr key={i} className={s.confidence < LOW_CONFIDENCE ? "weak" : ""}>
                <td>{i + 1}</td>
                <td>{clock(s.start_s)}</td>
                <td>{clock(Math.min(s.end_s, duration))}</td>
                <td className={isDrift(s) ? "drift-text" : undefined}>
                  {offset(s.offset_start)}
                  {isDrift(s) && ` → ${offset(s.offset_end)}`}
                </td>
                <td>{counts[i]}</td>
                <td>
                  <ConfidenceGauge value={s.confidence} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** "Décalage constant de +1.060 s" / "6 segments · 5 sauts" (Bobine Audio's
 * wording: segments, then jumps). */
function summarize(analysis: Analysis): string {
  const segments = analysis.segments;
  return segments.length === 1 && !isDrift(segments[0])
    ? t().analysis.constant(offset(segments[0].offset_start))
    : describeSegments(segments);
}

/** Where an analysis' cues are, for the chart's ticks: the reference's,
 * and the corrected ones (those kept). */
export function chartCues(analysis: Analysis) {
  return {
    reference: analysis.reference_cues.map(([a, b]) => [a, b] as const),
    corrected: analysis.target_cues.flatMap((c) => (c.corrected ? [c.corrected] : [])),
  };
}

/** A corrected line this long after the reference's last one is a stray
 * (a credit line timed hours later): left off the timeline (the engine's
 * filters._STRAY_GAP_S). */
const STRAY_GAP_S = 600;

/** The end of everything on screen: the timeline's length. */
export function analysisDuration(analysis: Analysis, known: number | null = null): number {
  const reference = Math.max(known ?? 0, ...analysis.reference_cues.map(([, b]) => b));
  const corrected = analysis.target_cues.map((c) => c.corrected?.[1] ?? 0).filter((end) => end <= reference + STRAY_GAP_S);
  return Math.max(reference, ...corrected);
}
