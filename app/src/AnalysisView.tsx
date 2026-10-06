import type { Analysis } from "./api";
import { clock, offset } from "./format";
import { LOW_CONFIDENCE } from "./shared";
import Timeline from "./Timeline";

/** Everything an analysis found: summary, timeline, segments. Shared by the
 * single-file view and a batch row's details. */
export default function AnalysisView({ analysis, duration }: { analysis: Analysis; duration: number }) {
  const segments = analysis.segments;
  const counts = segments.map((_, g) => analysis.target_cues.filter((c) => c.group === g).length);
  const orphans = analysis.target_cues.filter((c) => c.group < 0).length;
  const dropped = analysis.target_cues.filter((c) => c.corrected === null || c.corrected[1] <= 0).length;

  return (
    <>
      <section className="card">
        <div className="summary">
          <div>
            <h2>{summarize(analysis)}</h2>
            {analysis.ratio_name && <div className="badge">Dérive : {analysis.ratio_name}</div>}
            {analysis.reference_choice && <div className="muted">Référence : piste {analysis.reference_choice}</div>}
          </div>
          <div className="muted right">
            {analysis.reference_cues.length} répliques de référence · {analysis.target_cues.length} à corriger
            {orphans > 0 && <div>{orphans} sans équivalent (ou non dialoguées)</div>}
            {dropped > 0 && <div className="warn-text">{dropped} seront retirées</div>}
          </div>
        </div>
        {analysis.warnings.map((w) => (
          <p key={w} className="warning">
            ⚠ {w}
          </p>
        ))}
        <Timeline analysis={analysis} duration={duration} />
      </section>

      <section className="card">
        <h2>Segments</h2>
        <table className="segments">
          <thead>
            <tr>
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
                <td>{clock(s.start_s)}</td>
                <td>{clock(Math.min(s.end_s, duration))}</td>
                <td className="num">
                  {offset(s.offset_start)}
                  {Math.abs(s.offset_end - s.offset_start) > 0.05 && ` → ${offset(s.offset_end)}`}
                </td>
                <td className="num">{counts[i]}</td>
                <td className="num">
                  {Math.round(s.confidence * 100)} %{s.confidence < LOW_CONFIDENCE && " ⚠"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

/** "Décalage constant de +1.060 s" / "5 sauts, 6 segments" */
export function summarize(analysis: Analysis): string {
  const segments = analysis.segments;
  return segments.length === 1
    ? `Décalage constant de ${offset(segments[0].offset_start)}`
    : `${segments.length - 1} saut${segments.length > 2 ? "s" : ""}, ${segments.length} segments`;
}

/** The end of everything on screen: the timeline's length. */
export function analysisDuration(analysis: Analysis, known: number | null = null): number {
  return Math.max(
    known ?? 0,
    ...analysis.reference_cues.map(([, b]) => b),
    ...analysis.target_cues.map((c) => c.corrected?.[1] ?? 0),
  );
}
