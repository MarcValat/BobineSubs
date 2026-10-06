import { useMemo, useState } from "react";
import type { Analysis } from "./api";
import { clock, offset as formatOffset } from "./format";
import { useElementWidth } from "./useElementWidth";
import "./Timeline.css";

const LOW_CONFIDENCE = 0.8;
const ZOOMS = [10, 30, 60, 120];
const OVERVIEW_HEIGHT = 120;
const OVERVIEW_PAD = { top: 12, bottom: 30, left: 56, right: 12 };

interface Props {
  analysis: Analysis;
  duration: number;
}

/** The whole file at a glance (offset per segment, where lines are), and a
 * close-up window comparing the reference with the target before and after
 * correction, line by line. */
export default function Timeline({ analysis, duration }: Props) {
  const [zoom, setZoom] = useState(30);
  const [centre, setCentre] = useState(() => firstLine(analysis) + zoom / 2 - 2);
  const boundaries = useMemo(() => analysis.segments.slice(1).map((s) => s.start_s), [analysis]);

  const windowStart = Math.max(0, Math.min(centre - zoom / 2, duration - zoom));
  const windowEnd = windowStart + zoom;

  const goToJump = (direction: 1 | -1) => {
    const next =
      direction > 0 ? boundaries.find((b) => b > centre + 0.01) : [...boundaries].reverse().find((b) => b < centre - 0.01);
    if (next !== undefined) setCentre(next);
  };

  return (
    <div className="timeline">
      <Overview analysis={analysis} duration={duration} windowStart={windowStart} windowEnd={windowEnd} onPick={setCentre} />
      <div className="timeline-controls">
        <div className="button-group">
          <button onClick={() => goToJump(-1)} disabled={!boundaries.some((b) => b < centre - 0.01)}>
            ← Saut précédent
          </button>
          <button onClick={() => goToJump(1)} disabled={!boundaries.some((b) => b > centre + 0.01)}>
            Saut suivant →
          </button>
        </div>
        <span className="timeline-window">
          {clock(windowStart, 0)} – {clock(windowEnd, 0)}
        </span>
        <div className="button-group">
          {ZOOMS.map((z) => (
            <button key={z} className={z === zoom ? "active" : ""} onClick={() => setZoom(z)}>
              {z < 60 ? `${z} s` : `${z / 60} min`}
            </button>
          ))}
        </div>
      </div>
      <Detail analysis={analysis} start={windowStart} end={windowEnd} boundaries={boundaries} />
    </div>
  );
}

function firstLine(analysis: Analysis): number {
  return analysis.reference_cues[0]?.[0] ?? 0;
}

function Overview({
  analysis,
  duration,
  windowStart,
  windowEnd,
  onPick,
}: Props & { windowStart: number; windowEnd: number; onPick: (t: number) => void }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const plotWidth = Math.max(1, width - OVERVIEW_PAD.left - OVERVIEW_PAD.right);
  const plotHeight = OVERVIEW_HEIGHT - OVERVIEW_PAD.top - OVERVIEW_PAD.bottom;

  const offsets = analysis.segments.flatMap((s) => [s.offset_start, s.offset_end]);
  let lo = Math.min(...offsets);
  let hi = Math.max(...offsets);
  const margin = Math.max(0.1, (hi - lo) * 0.2);
  lo -= margin;
  hi += margin;

  const x = (t: number) => OVERVIEW_PAD.left + (t / duration) * plotWidth;
  const y = (o: number) => OVERVIEW_PAD.top + ((hi - o) / (hi - lo)) * plotHeight;
  const ticks = timeTicks(duration, plotWidth);

  const pick = (e: React.MouseEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const t = ((e.clientX - box.left - OVERVIEW_PAD.left) / plotWidth) * duration;
    onPick(Math.max(0, Math.min(duration, t)));
  };

  return (
    <div ref={ref} className="overview">
      {width > 0 && (
        <svg width={width} height={OVERVIEW_HEIGHT} onMouseDown={pick} onMouseMove={(e) => e.buttons === 1 && pick(e)}>
          {analysis.segments.map((s, i) => (
            <rect
              key={i}
              x={x(s.start_s)}
              y={OVERVIEW_PAD.top}
              width={Math.max(0, x(Math.min(s.end_s, duration)) - x(s.start_s))}
              height={plotHeight}
              className={`segment-band ${i % 2 ? "odd" : "even"} ${s.confidence < LOW_CONFIDENCE ? "weak" : ""}`}
            >
              <title>
                {`${clock(s.start_s)} – ${clock(s.end_s)} : ${formatOffset(s.offset_start)}` +
                  (Math.abs(s.offset_end - s.offset_start) > 0.05 ? ` → ${formatOffset(s.offset_end)}` : "") +
                  ` (confiance ${Math.round(s.confidence * 100)} %)`}
              </title>
            </rect>
          ))}
          {/* Where lines are: reference above, corrected target below. */}
          {analysis.reference_cues.map(([a, b], i) => (
            <rect key={`r${i}`} x={x(a)} y={OVERVIEW_PAD.top + plotHeight + 3} width={Math.max(1, x(b) - x(a))} height={4} className="density ref" />
          ))}
          {analysis.target_cues.map((c, i) =>
            c.corrected ? (
              <rect
                key={`t${i}`}
                x={x(c.corrected[0])}
                y={OVERVIEW_PAD.top + plotHeight + 8}
                width={Math.max(1, x(c.corrected[1]) - x(c.corrected[0]))}
                height={4}
                className="density target"
              />
            ) : null,
          )}
          <line x1={OVERVIEW_PAD.left} x2={OVERVIEW_PAD.left + plotWidth} y1={y(0)} y2={y(0)} className="zero-line" />
          {analysis.segments.map((s, i) => (
            <line
              key={i}
              x1={x(s.start_s)}
              x2={x(Math.min(s.end_s, duration))}
              y1={y(s.offset_start)}
              y2={y(s.offset_start + ((s.offset_end - s.offset_start) * (Math.min(s.end_s, duration) - s.start_s)) / (s.end_s - s.start_s))}
              className={`offset-line ${s.confidence < LOW_CONFIDENCE ? "weak" : ""}`}
            />
          ))}
          <text x={OVERVIEW_PAD.left - 6} y={y(hi - margin) + 4} className="axis-label" textAnchor="end">
            {formatOffset(hi - margin)}
          </text>
          <text x={OVERVIEW_PAD.left - 6} y={y(lo + margin) + 4} className="axis-label" textAnchor="end">
            {formatOffset(lo + margin)}
          </text>
          {ticks.map((t) => (
            <text key={t} x={x(t)} y={OVERVIEW_HEIGHT - 4} className="axis-label" textAnchor="middle">
              {clock(t, 0)}
            </text>
          ))}
          <rect
            x={x(windowStart)}
            y={OVERVIEW_PAD.top - 4}
            width={Math.max(2, x(windowEnd) - x(windowStart))}
            height={plotHeight + 20}
            className="viewport"
          />
        </svg>
      )}
    </div>
  );
}

function timeTicks(duration: number, width: number): number[] {
  const count = Math.max(2, Math.floor(width / 90));
  const steps = [30, 60, 120, 300, 600, 900, 1800, 3600];
  const step = steps.find((s) => duration / s <= count) ?? 3600;
  const ticks = [];
  for (let t = 0; t <= duration; t += step) ticks.push(t);
  return ticks;
}

function Detail({ analysis, start, end, boundaries }: { analysis: Analysis; start: number; end: number; boundaries: number[] }) {
  const span = end - start;
  const left = (t: number) => `${((t - start) / span) * 100}%`;
  const width = (a: number, b: number) => `${(Math.max(0, b - a) / span) * 100}%`;
  const inView = (a: number, b: number) => b > start && a < end;

  const rows: { label: string; cues: { a: number; b: number; text: string; kind: string; tip: string }[] }[] = [
    {
      label: "Référence",
      cues: analysis.reference_cues
        .filter(([a, b]) => inView(a, b))
        .map(([a, b]) => ({ a, b, text: "", kind: "ref", tip: `${clock(a, 2)} → ${clock(b, 2)}` })),
    },
    {
      label: "Avant",
      cues: analysis.target_cues
        .filter((c) => inView(c.start, c.end))
        .map((c) => ({ a: c.start, b: c.end, text: c.text, kind: "before", tip: `${clock(c.start, 2)} → ${clock(c.end, 2)}\n${c.text}` })),
    },
    {
      label: "Après",
      cues: analysis.target_cues
        .filter((c) => c.corrected && inView(c.corrected[0], c.corrected[1]))
        .map((c) => ({
          a: c.corrected![0],
          b: c.corrected![1],
          text: c.text,
          kind: c.group < 0 ? "after orphan" : "after",
          tip: `${clock(c.corrected![0], 2)} → ${clock(c.corrected![1], 2)}\n${c.text}${c.group < 0 ? "\n(sans équivalent dans la référence)" : ""}`,
        })),
    },
  ];

  return (
    <div className="detail">
      {rows.map((row) => (
        <div key={row.label} className="detail-row">
          <span className="detail-label">{row.label}</span>
          <div className="detail-lane">
            {boundaries
              .filter((b) => b > start && b < end)
              .map((b) => (
                <div key={b} className="boundary" style={{ left: left(b) }} />
              ))}
            {row.cues.map((c, i) => (
              <div key={i} className={`cue ${c.kind}`} style={{ left: left(c.a), width: width(c.a, c.b) }} title={c.tip}>
                {c.text.split("\n").join(" / ")}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
