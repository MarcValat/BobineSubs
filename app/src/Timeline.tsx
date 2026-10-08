import { useMemo, useRef, useState } from "react";
import type { Analysis } from "./api";
import { isDrift, offsetAt } from "./editing";
import { clock, offset as formatOffset } from "./format";
import { segmentFor } from "./retime";
import { LOW_CONFIDENCE } from "./shared";
import { useElementWidth } from "./useElementWidth";
import "./Timeline.css";

const ZOOMS = [10, 30, 60, 120];
const OVERVIEW_HEIGHT = 130;
const OVERVIEW_PAD = { top: 14, bottom: 30, left: 60, right: 14 };

/** What the timeline can change when it's in the segment editor; each
 * drag reports as it moves (`done` false) and once released (`done` true). */
export interface TimelineEditing {
  onDragBoundary: (i: number, t: number, done: boolean) => void;
  onDragSegment: (i: number, delta: number, done: boolean) => void;
  onSplit: (t: number) => void;
  /** Move segment `i` so that target time `from` lands on reference time `to`. */
  onAlign: (i: number, from: number, to: number) => void;
}

interface Props {
  analysis: Analysis;
  duration: number;
  editing?: TimelineEditing;
}

/** The whole file at a glance (offset per segment, where lines are), and a
 * close-up window comparing the reference with the target before and after
 * correction, line by line. */
export default function Timeline({ analysis, duration, editing }: Props) {
  const [zoom, setZoom] = useState(30);
  const [centre, setCentre] = useState(() => (analysis.reference_cues[0]?.[0] ?? 0) + zoom / 2 - 2);
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
      <Overview
        analysis={analysis}
        duration={duration}
        windowStart={windowStart}
        windowEnd={windowEnd}
        onPick={setCentre}
        editing={editing}
      />
      {/* As Bobine Audio's segment chart. */}
      <div className="segment-chart-legend">
        <span className="legend-item">
          <span className="legend-swatch constant" /> constant
        </span>
        <span className="legend-item">
          <span className="legend-swatch drift" /> dérive
        </span>
        {analysis.segments.some((s) => s.confidence < LOW_CONFIDENCE) && (
          <span className="legend-item">
            <span className="legend-swatch low-confidence" /> peu fiable
          </span>
        )}
      </div>
      <div className="timeline-controls">
        <div className="button-group">
          <span className="toolbar-label">Aller à :</span>
          <button className="small-button" onClick={() => goToJump(-1)} disabled={!boundaries.some((b) => b < centre - 0.01)}>
            ← Saut précédent
          </button>
          <button className="small-button" onClick={() => goToJump(1)} disabled={!boundaries.some((b) => b > centre + 0.01)}>
            Saut suivant →
          </button>
          {editing && (
            <button className="small-button" onClick={() => editing.onSplit(centre)} title="Couper le segment au centre de la loupe">
              ✂ Couper ici
            </button>
          )}
        </div>
        <span className="timeline-window">
          {clock(windowStart, 0)} – {clock(windowEnd, 0)}
        </span>
        <div className="button-group">
          <span className="toolbar-label">Zoom :</span>
          {ZOOMS.map((z) => (
            <button key={z} className={z === zoom ? "small-button primary-button" : "small-button"} onClick={() => setZoom(z)}>
              {z < 60 ? `${z} s` : `${z / 60} min`}
            </button>
          ))}
        </div>
      </div>
      <Detail analysis={analysis} start={windowStart} end={windowEnd} boundaries={boundaries} editing={editing} />
    </div>
  );
}

type Drag = { kind: "boundary"; i: number } | { kind: "segment"; i: number; startY: number; lo: number; hi: number } | { kind: "pick" };

function Overview({
  analysis,
  duration,
  windowStart,
  windowEnd,
  onPick,
  editing,
}: Props & { windowStart: number; windowEnd: number; onPick: (t: number) => void }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const drag = useRef<Drag | null>(null);
  const [frozen, setFrozen] = useState<[number, number] | null>(null);
  const plotWidth = Math.max(1, width - OVERVIEW_PAD.left - OVERVIEW_PAD.right);
  const plotHeight = OVERVIEW_HEIGHT - OVERVIEW_PAD.top - OVERVIEW_PAD.bottom;

  const offsets = analysis.segments.flatMap((s) => [s.offset_start, s.offset_end]);
  const dataLo = Math.min(...offsets);
  const dataHi = Math.max(...offsets);
  const margin = Math.max(0.1, (dataHi - dataLo) * 0.2);
  // While a segment is dragged, the scale stays put: it would otherwise
  // follow the segment and the drag would run away.
  const [lo, hi] = frozen ?? [dataLo - margin, dataHi + margin];

  const x = (t: number) => OVERVIEW_PAD.left + (t / duration) * plotWidth;
  const y = (o: number) => OVERVIEW_PAD.top + ((hi - o) / (hi - lo)) * plotHeight;
  const timeAt = (clientX: number, box: DOMRect) =>
    Math.max(0, Math.min(duration, ((clientX - box.left - OVERVIEW_PAD.left) / plotWidth) * duration));
  const ticks = timeTicks(duration, plotWidth);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const target = e.target as Element;
    const box = e.currentTarget.getBoundingClientRect();
    e.currentTarget.setPointerCapture(e.pointerId);
    const boundary = target.getAttribute("data-boundary");
    const segment = target.getAttribute("data-segment");
    if (editing && boundary !== null) {
      drag.current = { kind: "boundary", i: Number(boundary) };
    } else if (editing && segment !== null) {
      drag.current = { kind: "segment", i: Number(segment), startY: e.clientY, lo, hi };
      setFrozen([lo, hi]);
    } else {
      drag.current = { kind: "pick" };
      onPick(timeAt(e.clientX, box));
    }
  };

  const report = (e: React.PointerEvent<SVGSVGElement>, done: boolean) => {
    const d = drag.current;
    if (!d) return;
    const box = e.currentTarget.getBoundingClientRect();
    if (d.kind === "pick") onPick(timeAt(e.clientX, box));
    else if (d.kind === "boundary") editing?.onDragBoundary(d.i, timeAt(e.clientX, box), done);
    else editing?.onDragSegment(d.i, ((d.startY - e.clientY) / plotHeight) * (d.hi - d.lo), done);
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    report(e, true);
    drag.current = null;
    setFrozen(null);
  };

  return (
    <div ref={ref} className={`overview ${editing ? "editable" : ""}`}>
      {width > 0 && (
        <svg
          width={width}
          height={OVERVIEW_HEIGHT}
          onPointerDown={onPointerDown}
          onPointerMove={(e) => report(e, false)}
          onPointerUp={onPointerUp}
          onDoubleClick={(e) => editing?.onSplit(timeAt(e.clientX, e.currentTarget.getBoundingClientRect()))}
        >
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
          {analysis.segments.map((s, i) => {
            const end = Math.min(s.end_s, duration);
            return (
              <g key={i}>
                <line x1={x(s.start_s)} x2={x(end)} y1={y(s.offset_start)} y2={y(offsetAt(s, end))} className={`offset-line ${isDrift(s) ? "drift" : "constant"}${s.confidence < LOW_CONFIDENCE ? " low-confidence" : ""}`} />
                {editing && (
                  <line x1={x(s.start_s)} x2={x(end)} y1={y(s.offset_start)} y2={y(offsetAt(s, end))} className="offset-hit" data-segment={i}>
                    <title>Glisser vers le haut ou le bas pour changer le décalage</title>
                  </line>
                )}
              </g>
            );
          })}
          {editing &&
            analysis.segments.slice(1).map((s, k) => (
              <g key={`b${k}`}>
                <line x1={x(s.start_s)} x2={x(s.start_s)} y1={OVERVIEW_PAD.top} y2={OVERVIEW_PAD.top + plotHeight} className="boundary-line" />
                <circle cx={x(s.start_s)} cy={OVERVIEW_PAD.top + plotHeight / 2} r={7} className="boundary-handle" data-boundary={k + 1}>
                  <title>Glisser pour déplacer la frontière</title>
                </circle>
              </g>
            ))}
          <text x={OVERVIEW_PAD.left - 6} y={y(hi - (frozen ? 0 : margin)) + 4} className="axis-label" textAnchor="end">
            {formatOffset(frozen ? hi : dataHi)}
          </text>
          <text x={OVERVIEW_PAD.left - 6} y={y(lo + (frozen ? 0 : margin)) + 4} className="axis-label" textAnchor="end">
            {formatOffset(frozen ? lo : dataLo)}
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

interface Lane {
  label: string;
  cues: { a: number; b: number; text: string; kind: string; tip: string; target?: number; ref?: number }[];
}

function Detail({
  analysis,
  start,
  end,
  boundaries,
  editing,
}: {
  analysis: Analysis;
  start: number;
  end: number;
  boundaries: number[];
  editing?: TimelineEditing;
}) {
  // Align tool: the target cue picked first ("Après" row).
  const [picked, setPicked] = useState<number | null>(null);
  const span = end - start;
  const left = (t: number) => `${((t - start) / span) * 100}%`;
  const width = (a: number, b: number) => `${(Math.max(0, b - a) / span) * 100}%`;
  const inView = (a: number, b: number) => b > start && a < end;

  const rows: Lane[] = [
    {
      label: "Référence",
      cues: analysis.reference_cues
        .map(([a, b, text], ref) => ({ a, b, text, ref }))
        .filter(({ a, b }) => inView(a, b))
        .map(({ a, b, text, ref }) => ({ a, b, text, kind: "ref", ref, tip: `${clock(a, 2)} → ${clock(b, 2)}${text ? `
${text}` : ""}` })),
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
        .map((c, target) => ({ c, target }))
        .filter(({ c }) => c.corrected && inView(c.corrected[0], c.corrected[1]))
        .map(({ c, target }) => ({
          a: c.corrected![0],
          b: c.corrected![1],
          text: c.text,
          target,
          kind: `after ${c.group < 0 ? "orphan" : ""} ${picked === target ? "picked" : ""}`,
          tip: `${clock(c.corrected![0], 2)} → ${clock(c.corrected![1], 2)}\n${c.text}${c.group < 0 ? "\n(sans équivalent dans la référence)" : ""}`,
        })),
    },
  ];

  const click = (cue: Lane["cues"][number]) => {
    if (!editing) return;
    if (cue.target !== undefined) {
      setPicked(picked === cue.target ? null : cue.target);
    } else if (cue.ref !== undefined && picked !== null) {
      const tc = analysis.target_cues[picked];
      const i = segmentFor((tc.start + tc.end) / 2, analysis.segments);
      if (i !== null) editing.onAlign(i, tc.start, cue.a);
      setPicked(null);
    }
  };

  return (
    <div className="detail">
      {editing && (
        <p className="hint align-hint">
          {picked === null
            ? "Aligner : clique une réplique de la ligne « Après », puis la réplique de référence où elle doit tomber."
            : "Maintenant, clique la réplique de référence où elle doit tomber (ou reclique-la pour annuler)."}
        </p>
      )}
      {rows.map((row) => (
        <div key={row.label} className="detail-row">
          <span className="detail-label">{row.label}</span>
          <div className={`detail-lane ${editing ? "clickable" : ""}`}>
            {boundaries
              .filter((b) => b > start && b < end)
              .map((b) => (
                <div key={b} className="boundary" style={{ left: left(b) }} />
              ))}
            {row.cues.map((c, i) => (
              <div
                key={i}
                className={`cue ${c.kind} ${editing && picked !== null && c.ref !== undefined ? "aim" : ""}`}
                style={{ left: left(c.a), width: width(c.a, c.b) }}
                title={c.tip}
                onClick={() => click(c)}
              >
                {c.text.split("\n").join(" / ")}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
