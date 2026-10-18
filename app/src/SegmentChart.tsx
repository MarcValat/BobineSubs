import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Segment } from "./api";
import { isDrift } from "./editing";
import { clock, offset } from "./format";
import { t, useT } from "./i18n";
import { LOW_CONFIDENCE } from "./shared";
import type { TimeView } from "./timeView";
import "./SegmentChart.css";

// Drawn at its real on-screen width and a fixed height, so its text stays
// the same size on any window, instead of scaling a fixed picture (too tall
// on a wide window, unreadably small on a narrow one). A bit lower on a
// short window, where the loupe below needs the room.
const HEIGHT = 150;
const COMPACT_HEIGHT = 120;
const SHORT_WINDOW = "(max-height: 850px)";

/** Whether the window is short enough for charts to take less height. */
function useShortWindow(): boolean {
  const [short, setShort] = useState(() => window.matchMedia(SHORT_WINDOW).matches);
  useEffect(() => {
    const query = window.matchMedia(SHORT_WINDOW);
    const onChange = () => setShort(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return short;
}
// Bobine Subs: the cues' two rows of ticks (CUE_ROWS high) between the plot
// and the time axis.
const CUE_ROWS = 12;
const MARGIN = { top: 14, right: 16, bottom: 26 + CUE_ROWS, left: 70 };

/** A segment label's width (px) at the charts' 11px: a guess from its
 * length, the digits all one width (tabular). */
export const labelWidth = (text: string) => text.length * 6.3 + 4;

/** Where each segment's label goes on a plot `width` x `height` px, each
 * wanted at (`x`, `y`): above its line, else below, else higher still --
 * never over another label nor past the plot's sides -- or hidden when
 * none of those is free. The longest segments placed first (`weight`):
 * a short one's label gives way. */
export function placeLabels(
  labels: { x: number; y: number; width: number; weight: number }[],
  width: number,
  height: number,
): ({ x: number; y: number } | null)[] {
  const placed: { left: number; right: number; top: number; bottom: number }[] = [];
  const result: ({ x: number; y: number } | null)[] = labels.map(() => null);
  const order = labels.map((_, i) => i).sort((a, b) => labels[b].weight - labels[a].weight);
  for (const i of order) {
    const label = labels[i];
    const half = label.width / 2;
    const x = Math.max(Math.min(half, width / 2), Math.min(width - half, label.x));
    for (const dy of [-8, 16, -22, 30]) {
      const y = label.y + dy;
      const box = { left: x - half, right: x + half, top: y - 11, bottom: y + 3 };
      if (box.top < -10 || box.bottom > height + 4) continue;
      if (placed.some((p) => p.left < box.right && box.left < p.right && p.top < box.bottom && box.top < p.bottom)) continue;
      placed.push(box);
      result[i] = { x, y };
      break;
    }
  }
  return result;
}

/** The width of the element given the returned callback ref, by steps of
 * `step` px: enough to lay labels out, without rendering again at every
 * pixel of a resize. */
function useCoarseWidth<T extends Element>(step: number): [(el: T | null) => void, number] {
  const [element, setElement] = useState<T | null>(null);
  const [width, setWidth] = useState(0);
  const ref = useCallback((el: T | null) => setElement(el), []);
  useEffect(() => {
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width / step) * step));
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, step]);
  return [ref, width];
}

// Offset change at a boundary below which it isn't counted as a jump.
const JUMP_MIN_S = 0.001;

/** The offset scale of a chart of these offsets (seconds): always
 * including 0 (the reference), 15% of room above and below. */
export function offsetRange(offsets: number[]): [number, number] {
  let min = Math.min(0, ...offsets);
  let max = Math.max(0, ...offsets);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const pad = (max - min) * 0.15;
  return [min - pad, max + pad];
}

/** The offsets a segment's line is drawn at, start and end. A constant
 * segment is drawn perfectly flat, at the mean of its two offsets: it's
 * classified constant because they're close enough, not bit-for-bit equal,
 * and a visible tilt on a segment labelled "constant" reads as a rendering
 * bug rather than the measurement noise it is. A drift keeps its real
 * slope -- that's the whole point. */
export function drawnOffsets(seg: Segment): [number, number] {
  if (isDrift(seg)) return [seg.offset_start, seg.offset_end];
  const flat = (seg.offset_start + seg.offset_end) / 2;
  return [flat, flat];
}

/** Round tick values covering [min, max] (seconds), about `target` of them. */
export function offsetTicks(min: number, max: number, target = 5): number[] {
  const span = max - min;
  if (!(span > 0)) return [];
  const raw = span / target;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? 10 * magnitude;
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return ticks;
}

/** A segment's offset label: its value, or both ends for a drift. */
export function segmentOffsetLabel(seg: Segment): string {
  if (isDrift(seg)) return `${offset(seg.offset_start)} → ${offset(seg.offset_end)}`;
  return offset((seg.offset_start + seg.offset_end) / 2);
}

/** "3 segments · 2 sauts · 1 peu fiable", for a track's analysis header. */
export function describeSegments(segments: Segment[]): string {
  const m = t().chart;
  const jumps = segments.slice(1).filter((seg, i) => Math.abs(seg.offset_start - segments[i].offset_end) >= JUMP_MIN_S).length;
  const drifts = segments.filter(isDrift).length;
  const unreliable = segments.filter((seg) => seg.confidence < LOW_CONFIDENCE).length;
  const parts = [m.segments(segments.length)];
  if (jumps > 0) parts.push(m.jumps(jumps));
  if (drifts > 0) parts.push(m.drifts(drifts));
  if (unreliable > 0) parts.push(m.unreliableCount(unreliable));
  return parts.join(" · ");
}

/** The chart's frame before there's anything to draw: `children` (what's
 * going on) where the plot will be, at its size and with its legend's room,
 * so nothing moves when the chart comes. */
export function SegmentChartPlaceholder({ children }: { children: ReactNode }) {
  const tr = useT();
  const compact = useShortWindow();
  return (
    <div className="segment-chart segment-chart-placeholder">
      <div className="segment-chart-placeholder-body" style={{ height: compact ? COMPACT_HEIGHT : HEIGHT }}>
        {children}
      </div>
      <div className="segment-chart-footer" aria-hidden="true" style={{ visibility: "hidden" }}>
        <div className="segment-chart-legend">
          <span className="legend-item">
            <span className="legend-swatch constant" /> {tr.chart.constant}
          </span>
        </div>
      </div>
    </div>
  );
}

/** What a segment chart's lines mean: constant, drift, and unreliable
 * when some are (the chart, the segment editor). */
export function SegmentLegend({ unreliable }: { unreliable: boolean }) {
  const tr = useT();
  return (
    <div className="segment-chart-legend">
      <span className="legend-item">
        <span className="legend-swatch constant" /> {tr.chart.constant}
      </span>
      <span className="legend-item">
        <span className="legend-swatch drift" /> {tr.chart.drift}
      </span>
      {unreliable && (
        <span className="legend-item">
          <span className="legend-swatch low-confidence" /> {tr.chart.unreliable}
        </span>
      )}
    </div>
  );
}

/** Cues as one SVG path of thin bars on a 0..1000 wide axis (`total`
 * seconds), `y` to `y + h`: hundreds of them, one element. */
function cueTicks(cues: readonly (readonly [number, number])[], total: number, y: number, h: number): string {
  if (total <= 0) return "";
  return cues
    .map(([a, b]) => {
      const x = (a / total) * 1000;
      const w = Math.max(1, ((b - a) / total) * 1000);
      return `M${x.toFixed(1)} ${y}h${w.toFixed(1)}v${h}h${(-w).toFixed(1)}Z`;
    })
    .join("");
}

/**
 * A hand-rolled SVG offset-vs-time chart -- no charting library needed for
 * something this simple, and it keeps the GUI's dependency footprint small.
 * Each segment is drawn as a line from (start_s, offset_start) to (end_s,
 * offset_end): flat for a constant offset, sloped for a drift. From Bobine
 * Audio's; Bobine Subs adds under it where the cues are (`cues`: the
 * reference's, then the corrected ones), and the loupe's stretch (`view`)
 * as a frame: a click or a drag on the chart takes the loupe there
 * (`onPick`, the time under the pointer).
 *
 * Its coordinates are shares of the plot (SVG percentages), not pixels of a
 * measured size: the browser lays it out at any size by itself, text and
 * strokes unscaled -- no measuring and drawing again in JS at every frame
 * of a resize (that made resizing jerky while it showed).
 */
export function SegmentChart({
  segments,
  duration,
  cues,
  view,
  onPick,
}: {
  segments: Segment[];
  /** The time axis' length: the video's, or the cues' end. */
  duration: number;
  cues?: { reference: readonly (readonly [number, number])[]; corrected: readonly (readonly [number, number])[] };
  view?: TimeView;
  onPick?: (time: number) => void;
}) {
  const tr = useT();
  const compact = useShortWindow();
  const plot = useRef<SVGSVGElement>(null);
  // The plot's width, for its labels (see placeLabels).
  const [measure, boxWidth] = useCoarseWidth<HTMLDivElement>(16);
  const plotWidth = Math.max(0, boxWidth - MARGIN.left - MARGIN.right);
  const total = duration > 0 ? duration : (segments[segments.length - 1]?.end_s ?? 0);
  // Once per analysis, not at every move of the loupe.
  const ticks = useMemo(
    () => cues && { reference: cueTicks(cues.reference, total, 0, 5), corrected: cueTicks(cues.corrected, total, 6, 5) },
    [cues, total],
  );

  if (segments.length === 0) return null;
  const height = compact ? COMPACT_HEIGHT : HEIGHT;

  const [minOffset, maxOffset] = offsetRange(segments.flatMap((s) => [s.offset_start, s.offset_end]));

  const pct = (share: number) => `${(share * 100).toFixed(3)}%`;
  const x = (time: number) => pct(total > 0 ? Math.min(time, total) / total : 0);
  const yShare = (o: number) => 1 - (o - minOffset) / (maxOffset - minOffset);
  const y = (o: number) => pct(yShare(o));

  // Each segment's label where it doesn't cover another one.
  const plotHeight = height - MARGIN.top - MARGIN.bottom;
  const labels = segments.map((seg) => segmentOffsetLabel(seg));
  const places = placeLabels(
    segments.map((seg, i) => {
      const [start, end] = drawnOffsets(seg);
      return {
        x: total > 0 ? ((seg.start_s + Math.min(seg.end_s, total)) / 2 / total) * plotWidth : 0,
        y: ((yShare(start) + yShare(end)) / 2) * plotHeight,
        width: labelWidth(labels[i]),
        weight: seg.end_s - seg.start_s,
      };
    }),
    plotWidth,
    plotHeight,
  );

  const timeTicks = 5;
  const timeTickValues = Array.from({ length: timeTicks + 1 }, (_, i) => (total * i) / timeTicks);

  function pick(clientX: number) {
    const rect = plot.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || !onPick) return;
    onPick(Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * total);
  }

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0 || !onPick) return;
    e.preventDefault();
    pick(e.clientX);
    const move = (ev: PointerEvent) => pick(ev.clientX);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  const plotBox = {
    top: MARGIN.top,
    left: MARGIN.left,
    width: `calc(100% - ${MARGIN.left + MARGIN.right}px)`,
    height: `calc(100% - ${MARGIN.top + MARGIN.bottom}px)`,
  };

  return (
    <div className="segment-chart">
      <div ref={measure} className={`segment-chart-box${onPick ? " pickable" : ""}`} style={{ height }} onPointerDown={onPointerDown}>
        {/* The plot's own box, inside the axes' margins; the labels drawn
          past its edges (overflow visible). */}
        <svg ref={plot} className="segment-chart-plot" style={plotBox} role="img" aria-label={tr.chart.ariaLabel}>
          {/* offset scale, with the zero line standing out */}
          {offsetTicks(minOffset, maxOffset, 3).map((v) => (
            <g key={v}>
              <line x1={0} y1={y(v)} x2="100%" y2={y(v)} className={v === 0 ? "zero-line" : "grid-line"} />
              <text x={-8} y={y(v)} className="axis-label" textAnchor="end" dominantBaseline="middle">
                {offset(v)}
              </text>
            </g>
          ))}

          {/* time axis, under the cues' rows */}
          {timeTickValues.map((time) => (
            <g key={time}>
              <line x1={x(time)} y1={0} x2={x(time)} y2="100%" className="grid-line" />
              <text x={x(time)} y="100%" dy={16 + CUE_ROWS} className="axis-label" textAnchor="middle">
                {clock(time, 0)}
              </text>
            </g>
          ))}

          {/* segments (see drawnOffsets) */}
          {segments.map((seg, i) => {
            const [start, end] = drawnOffsets(seg);
            return (
              <g key={i}>
                <line
                  x1={x(seg.start_s)}
                  y1={y(start)}
                  x2={x(seg.end_s)}
                  y2={y(end)}
                  className={`segment-line ${isDrift(seg) ? "drift" : "constant"}${seg.confidence < LOW_CONFIDENCE ? " low-confidence" : ""}`}
                />
                {plotWidth > 0 && places[i] && (
                  <text x={places[i].x} y={places[i].y} className="segment-label" textAnchor="middle">
                    {labels[i]}
                  </text>
                )}
              </g>
            );
          })}

          {/* the loupe's stretch */}
          {view && total > 0 && (
            <rect
              x={x(view.start)}
              y={0}
              width={pct(Math.max(0.004, Math.min(1, view.duration / total)))}
              height="100%"
              rx={3}
              className="segment-chart-view"
            />
          )}
        </svg>
        {ticks && (
          // Stretched to the plot's width: its own axis, 0..1000.
          <svg
            className="segment-chart-cues"
            style={{ left: plotBox.left, width: plotBox.width, top: `calc(100% - ${MARGIN.bottom}px + 1px)`, height: CUE_ROWS - 1 }}
            viewBox="0 0 1000 11"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path d={ticks.reference} className="cue-ticks reference" />
            <path d={ticks.corrected} className="cue-ticks corrected" />
          </svg>
        )}
      </div>
      <div className="segment-chart-footer">
        <SegmentLegend unreliable={segments.some((seg) => seg.confidence < LOW_CONFIDENCE)} />
        {cues && (
          <span className="segment-chart-cues-legend">
            <span className="legend-item">
              <span className="legend-swatch cues-reference" /> {tr.chart.referenceCues}
            </span>
            <span className="legend-item">
              <span className="legend-swatch cues-corrected" /> {tr.chart.correctedCues}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}
