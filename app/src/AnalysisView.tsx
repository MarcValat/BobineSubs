import type { Analysis } from "./api";
import { ConfidenceGauge } from "./ConfidenceGauge";
import { clock, offset } from "./format";
import { segmentFor } from "./retime";
import { LOW_CONFIDENCE } from "./shared";
import Timeline from "./Timeline";

/** Everything an analysis found, inside the Analyse panel (as Bobine
 * Audio's): what was found, the timeline, then the segments' table. */
export default function AnalysisView({
  analysis,
  duration,
  edited = false,
}: {
  analysis: Analysis;
  duration: number;
  /** The segments were changed by hand since the analysis. */
  edited?: boolean;
}) {
  const segments = analysis.segments;
  // By where each line falls now (hand edits move them between segments).
  const counts = segments.map((_, g) => analysis.target_cues.filter((c) => segmentFor((c.start + c.end) / 2, segments) === g).length);
  const orphans = analysis.target_cues.filter((c) => c.group < 0).length;
  const dropped = analysis.target_cues.filter((c) => c.corrected === null || c.corrected[1] <= 0).length;

  return (
    <div className="analysis-content">
      <div className="analysis-summary">
        <span className="analysis-found">{summarize(analysis)}</span>
        {analysis.ratio_name && <span className="badge">Dérive : {analysis.ratio_name}</span>}
        {edited && <span className="badge edited">Modifié à la main</span>}
        <span className="analysis-counts">
          {analysis.reference_cues.length} répliques de référence · {analysis.target_cues.length} à corriger
          {orphans > 0 && ` · ${orphans} sans équivalent (ou non dialoguées)`}
          {dropped > 0 && <span className="warn-text"> · {dropped} seront retirées</span>}
        </span>
      </div>
      {analysis.warnings.map((w) => (
        <p key={w} className="warning">
          ⚠ {w}
        </p>
      ))}
      <Timeline analysis={analysis} duration={duration} />
      <div className="tracks-table-wrap">
        <table className="data-table segments-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Début</th>
              <th>Fin</th>
              <th>Décalage</th>
              <th>Répliques</th>
              <th>Confiance</th>
            </tr>
          </thead>
          <tbody>
            {segments.map((s, i) => (
              <tr key={i} className={s.confidence < LOW_CONFIDENCE ? "weak" : ""}>
                <td>{i + 1}</td>
                <td>{clock(s.start_s)}</td>
                <td>{clock(Math.min(s.end_s, duration))}</td>
                <td>
                  {offset(s.offset_start)}
                  {Math.abs(s.offset_end - s.offset_start) > 0.05 && ` → ${offset(s.offset_end)}`}
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

/** "Décalage constant de +1.060 s" / "5 sauts · 6 segments" (Bobine Audio's
 * wording: segments, then jumps). */
export function summarize(analysis: Analysis): string {
  const segments = analysis.segments;
  const n = segments.length;
  return n === 1 ? `Décalage constant de ${offset(segments[0].offset_start)}` : `${n} segments · ${n - 1} saut${n > 2 ? "s" : ""}`;
}

/** The end of everything on screen: the timeline's length. */
export function analysisDuration(analysis: Analysis, known: number | null = null): number {
  return Math.max(
    known ?? 0,
    ...analysis.reference_cues.map(([, b]) => b),
    ...analysis.target_cues.map((c) => c.corrected?.[1] ?? 0),
  );
}
