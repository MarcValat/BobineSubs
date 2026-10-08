import { LOW_CONFIDENCE } from "./shared";

/** A segment's confidence at a glance: a thin bar filled to it, green when
 * reliable, orange when it's to check (⚠ under LOW_CONFIDENCE), the
 * percentage next to it. */
export function ConfidenceGauge({ value }: { value: number }) {
  const percent = Math.round(value * 100);
  const weak = value < LOW_CONFIDENCE;
  return (
    <span className={`confidence${weak ? " confidence-weak" : ""}`} title={weak ? "Peu fiable : à vérifier" : undefined}>
      <span className="confidence-bar" aria-hidden="true">
        <span className="confidence-fill" style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
      </span>
      <span className="confidence-value">{percent} %</span>
      {/* Room kept on every row: the bars stay aligned. */}
      <span className="confidence-flag">{weak ? "⚠" : ""}</span>
    </span>
  );
}
