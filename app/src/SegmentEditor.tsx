import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Analysis, Segment } from "./api";
import {
  align,
  commit,
  type History,
  isDrift,
  moveBoundary,
  redo,
  remove,
  removeUnreliable,
  setOffsets,
  shiftOffset,
  split,
  startHistory,
  undo,
} from "./editing";
import { drawnOffsets, offsetRange, offsetTicks, segmentOffsetLabel, SegmentLegend } from "./SegmentChart";
import { CueLoupe } from "./CueLoupe";
import { ConfidenceGauge } from "./ConfidenceGauge";
import { InfoTip } from "./InfoTip";
import { RedoEditIcon, UndoIcon } from "./icons";
import { clock, offset as formatOffset } from "./format";
import { segmentFor, withSegments } from "./retime";
import { LOW_CONFIDENCE } from "./shared";
import { panView, type TimeView, useDragPan, useWheel, WHEEL_ZOOM_IN_FACTOR, WHEEL_ZOOM_OUT_FACTOR, zoomView } from "./timeView";
import { useElementSize } from "./useElementSize";
import "./SegmentEditor.css";
import { Dialog, DialogHeader } from "./Dialog";
import { useT } from "./i18n";
import { FIELD_PROPS } from "./util";

// The chart is drawn at the size its box actually gets (measured), so its
// text keeps one size on any window.
const MIN_CHART_HEIGHT = 150;
const MARGIN = { top: 20, right: 20, bottom: 30, left: 76 };

/** What the pointer is currently dragging on the chart. */
type Drag =
  | { kind: "boundary"; index: number }
  // A whole segment, up or down: both its ends move together, so a drift keeps its slope.
  | { kind: "segment"; index: number; grabOffset: number };

/** "1:02:03.4", "2:03.4", "123.4" -> seconds; null if unreadable. */
function parseClock(text: string): number | null {
  const parts = text.trim().replace(",", ".").split(":");
  if (parts.length > 3 || parts.some((p) => p === "" || isNaN(Number(p)))) return null;
  return parts.reduce((total, p) => total * 60 + Number(p), 0);
}

/** A number field committed on Enter or when leaving it, not on each key
 * (a time typed digit by digit would move the boundary all over). */
function LazyInput({ value, label, onCommit }: { value: string; label: string; onCommit: (text: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      {...FIELD_PROPS}
      type="text"
      inputMode="decimal"
      aria-label={label}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== value && onCommit(text)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setText(value);
          e.stopPropagation();
        }
      }}
    />
  );
}

const msText = (seconds: number) => String(Math.round(seconds * 1000));

/** Hand-correct an analysis' segments, laid out as Bobine Audio's editor:
 * the offset chart (drag a segment up or down, a handle sideways,
 * double-click to cut), the cue loupe under it where Audio has its
 * waveforms -- the two on one stretch of time, zoomed and moved together
 * -- with "Couper ici" and Aligner, the segments' table, then undo / redo,
 * reset and save. Everything previewed live; `onSave` gets the new list
 * (exported as is, never re-detected). */
export function SegmentEditor({
  analysis,
  duration,
  subtitle,
  onSave,
  onClose,
}: {
  analysis: Analysis;
  duration: number;
  /** What's being corrected: "file · track against reference", beside the title. */
  subtitle?: string;
  onSave: (segments: Segment[]) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [history, setHistory] = useState<History>(() => startHistory(analysis.segments));
  // What a drag in progress shows, before it's committed (one undo step).
  const [live, setLive] = useState<Segment[] | null>(null);
  const liveRef = useRef(live);
  liveRef.current = live;
  const segments = live ?? history.present;
  const shown = useMemo(() => withSegments(analysis, segments), [analysis, segments]);
  const dirty = history.present !== analysis.segments;
  const apply = (next: Segment[]) => setHistory((h) => commit(h, next));

  const [dragging, setDragging] = useState<Drag | null>(null);
  const [frozenRange, setFrozenRange] = useState<[number, number] | null>(null);
  // The stretch of time on screen, the chart's and the loupe's.
  const [view, setView] = useState<TimeView>({ start: 0, duration });
  const svgRef = useRef<SVGSVGElement>(null);
  const [chartBoxRef, chartBox] = useElementSize<HTMLDivElement>();
  const chartWidth = Math.max(300, chartBox.width || 900);
  const chartHeight = Math.max(MIN_CHART_HEIGHT, chartBox.height || 200);
  // The segment whose "Retirer" button is hovered: shown on the chart, with
  // the neighbour that would take its place.
  const [removalPreview, setRemovalPreview] = useState<number | null>(null);
  // "Annuler" (or Escape) with unsaved changes asks first.
  const [confirmingClose, setConfirmingClose] = useState(false);
  const titleId = useId();
  const clipId = useId();

  function requestClose() {
    if (dirty) setConfirmingClose(true);
    else onClose();
  }

  // Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z), outside the table's fields (they
  // keep their own until committed).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || !(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        setHistory(undo);
      } else if (key === "y" || (key === "z" && e.shiftKey)) {
        e.preventDefault();
        setHistory(redo);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const PLOT_W = chartWidth - MARGIN.left - MARGIN.right;
  const PLOT_H = chartHeight - MARGIN.top - MARGIN.bottom;
  // Held still while dragging: rescaling under the pointer would make the
  // dragged segment run away from it.
  const [minOffset, maxOffset] = frozenRange ?? offsetRange(segments.flatMap((s) => [s.offset_start, s.offset_end]));
  const x = (time: number) => (view.duration > 0 ? ((time - view.start) / view.duration) * PLOT_W : 0);
  const xInv = (px: number) => (view.duration > 0 ? view.start + (px / PLOT_W) * view.duration : 0);
  const inView = (px: number) => px >= 0 && px <= PLOT_W;
  // A segment's label sits in the middle of its visible part, never cut
  // by the plot's edges (a drift's label is about 160px wide).
  const LABEL_HALF = 80;
  const labelX = (seg: Segment) =>
    Math.max(
      Math.min(LABEL_HALF, PLOT_W / 2),
      Math.min(PLOT_W - LABEL_HALF, (Math.max(0, x(seg.start_s)) + Math.min(PLOT_W, x(seg.end_s))) / 2),
    );
  const y = (value: number) => PLOT_H - ((value - minOffset) / (maxOffset - minOffset)) * PLOT_H;

  function timeFromClientX(clientX: number): number {
    const rect = svgRef.current!.getBoundingClientRect();
    return xInv(((clientX - rect.left) / rect.width) * chartWidth - MARGIN.left);
  }

  function offsetFromClientY(clientY: number): number {
    const rect = svgRef.current!.getBoundingClientRect();
    const svgY = ((clientY - rect.top) / rect.height) * chartHeight - MARGIN.top;
    return minOffset + ((PLOT_H - svgY) / PLOT_H) * (maxOffset - minOffset);
  }

  function startDrag(e: React.PointerEvent, next: Drag) {
    // No text selection while dragging, and not a pan of the view.
    e.preventDefault();
    e.stopPropagation();
    setFrozenRange([minOffset, maxOffset]);
    setDragging(next);
  }

  useEffect(() => {
    if (dragging === null) return;
    const drag = dragging;
    const base = history.present;
    function onMove(ev: PointerEvent) {
      if (drag.kind === "boundary") {
        setLive(moveBoundary(base, drag.index, timeFromClientX(ev.clientX)));
        return;
      }
      // Whole milliseconds: finer than anyone can place by hand anyway.
      const delta = Math.round((offsetFromClientY(ev.clientY) - drag.grabOffset) * 1000) / 1000;
      setLive(delta === 0 ? null : shiftOffset(base, drag.index, delta));
    }
    function onUp() {
      const moved = liveRef.current;
      setLive(null);
      if (moved) apply(moved);
      setDragging(null);
      setFrozenRange(null);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging]);

  // The wheel on the chart zooms both under the pointer (the loupe does the
  // same on its rows); a drag of the chart's background moves them.
  useWheel(svgRef, (e) => {
    const factor = e.deltaY < 0 ? WHEEL_ZOOM_IN_FACTOR : WHEEL_ZOOM_OUT_FACTOR;
    setView(zoomView(view, factor, timeFromClientX(e.clientX), duration));
  });
  const pan = useDragPan(svgRef, (share) => setView(panView(view, ((share * chartWidth) / PLOT_W) * view.duration, duration)));

  /** Double-click: cut the segment under the pointer at that time. */
  function handleChartDoubleClick(e: React.MouseEvent<SVGSVGElement>) {
    if ((e.target as Element).closest(".boundary-handle")) return;
    apply(split(history.present, Math.round(timeFromClientX(e.clientX) * 1000) / 1000));
  }

  // The segment "Retirer" would leave in place of the hovered one and its neighbour.
  const removalGhost =
    removalPreview !== null && removalPreview < segments.length && segments.length > 1
      ? remove(segments, removalPreview)[removalPreview < segments.length - 1 ? removalPreview : removalPreview - 1]
      : null;
  // Each segment's lines to correct, as it retimes them now.
  const cueCounts = useMemo(() => {
    const counts = segments.map(() => 0);
    for (const c of analysis.target_cues) {
      const i = segmentFor((c.start + c.end) / 2, segments);
      if (i !== null) counts[i] += 1;
    }
    return counts;
  }, [analysis, segments]);
  const unreliable = segments.length > 1 && segments.some((s) => s.confidence < LOW_CONFIDENCE);
  const timeTicks = Array.from({ length: 6 }, (_, i) => view.start + (view.duration * i) / 5);

  return (
    <Dialog
      fill
      labelledBy={titleId}
      onClose={onClose}
      // Escape backs out of the "abandon changes?" question first.
      onEscape={() => (confirmingClose ? setConfirmingClose(false) : requestClose())}
      className="editor-panel editor-panel-wide"
    >
      <DialogHeader
        id={titleId}
        titleTooltip={subtitle}
        title={
          <>
            {t.editor.title}{" "}
            <InfoTip>
              <ul>
                <li>{t.editor.help.dragSegment}</li>
                <li>{t.editor.help.dragHandle}</li>
                <li>{t.editor.help.split}</li>
                <li>{t.editor.help.wheel}</li>
                <li>{t.editor.help.align}</li>
                <li>{t.editor.help.unreliable}</li>
                <li>{t.editor.help.remove}</li>
                <li>{t.editor.help.undo}</li>
                <li>{t.editor.help.sign}</li>
              </ul>
            </InfoTip>
            {subtitle && <span className="editor-subtitle">{subtitle}</span>}
          </>
        }
      >
        {dirty && !confirmingClose && <span className="editor-changes">{t.editor.changes(history.past.length)}</span>}
        {/* What the lines mean, then the question when closing would lose
            edits (Annuler or Escape). */}
        <SegmentLegend unreliable={segments.some((s) => s.confidence < LOW_CONFIDENCE)} />
        {confirmingClose && (
          <div className="editor-confirm-close" role="alertdialog">
            <span>{t.editor.abandonQuestion}</span>
            <button className="small-button export-cancel" onClick={onClose}>
              {t.editor.abandon}
            </button>
            <button className="small-button" onClick={() => setConfirmingClose(false)}>
              {t.editor.keepEditing}
            </button>
          </div>
        )}
      </DialogHeader>

      <div className="editor-columns">
        <div className="editor-chart-box" ref={chartBoxRef}>
          <svg
            ref={svgRef}
            className={`editor-chart${dragging ? " editor-chart-dragging" : ""}`}
            viewBox={`0 0 ${chartWidth} ${chartHeight}`}
            role="img"
            aria-label={t.chart.ariaLabel}
            onPointerDown={pan.onPointerDown}
            onMouseDown={pan.onMouseDown}
            onDoubleClick={handleChartDoubleClick}
          >
            <defs>
              {/* Room above the plot for the boundary handles' circles. */}
              <clipPath id={clipId}>
                <rect x={0} y={-12} width={PLOT_W} height={PLOT_H + 24} />
              </clipPath>
            </defs>
            <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
              {offsetTicks(minOffset, maxOffset).map((v) => (
                <g key={v}>
                  <line x1={0} y1={y(v)} x2={PLOT_W} y2={y(v)} className={v === 0 ? "zero-line" : "grid-line"} />
                  <text x={-8} y={y(v)} className="axis-label" textAnchor="end" dominantBaseline="middle">
                    {formatOffset(v)}
                  </text>
                </g>
              ))}

              {timeTicks.map((time) => (
                <g key={time}>
                  <line x1={x(time)} y1={0} x2={x(time)} y2={PLOT_H} className="grid-line" />
                  <text x={x(time)} y={PLOT_H + 18} className="axis-label" textAnchor="middle">
                    {clock(time, view.duration < 60 ? 1 : 0)}
                  </text>
                </g>
              ))}

              <g clipPath={`url(#${clipId})`}>
                {segments.map((seg, i) => {
                  const [yStart, yEnd] = drawnOffsets(seg).map(y);
                  const isDragged = dragging?.kind === "segment" && dragging.index === i;
                  const low = seg.confidence < LOW_CONFIDENCE;
                  return (
                    <g key={i}>
                      <line
                        x1={x(seg.start_s)}
                        y1={yStart}
                        x2={x(seg.end_s)}
                        y2={yEnd}
                        className={`segment-line ${isDrift(seg) ? "drift" : "constant"}${low ? " low-confidence" : ""}${
                          removalPreview === i ? " removal-target" : ""
                        }`}
                      />
                      {/* A wide invisible stroke on top: the visible line is too thin to grab. */}
                      <line
                        x1={x(seg.start_s)}
                        y1={yStart}
                        x2={x(seg.end_s)}
                        y2={yEnd}
                        className="segment-hit"
                        onPointerDown={(e) => startDrag(e, { kind: "segment", index: i, grabOffset: offsetFromClientY(e.clientY) })}
                      />
                      {/* Its label only while some of it is in view. */}
                      {x(seg.end_s) > 0 && x(seg.start_s) < PLOT_W && (
                        <text
                          x={labelX(seg)}
                          y={yStart + (yEnd - yStart) * ((labelX(seg) - x(seg.start_s)) / (x(seg.end_s) - x(seg.start_s) || 1)) - 10}
                          className={`segment-label${isDragged ? " dragged" : ""}${low ? " low-confidence" : ""}`}
                          textAnchor="middle"
                        >
                          {segmentOffsetLabel(seg)}
                        </text>
                      )}
                    </g>
                  );
                })}

                {/* "Retirer" hovered: what the neighbour would become once stretched over the removed segment. */}
                {removalGhost && (
                  <line
                    x1={x(removalGhost.start_s)}
                    y1={y(drawnOffsets(removalGhost)[0])}
                    x2={x(removalGhost.end_s)}
                    y2={y(drawnOffsets(removalGhost)[1])}
                    className="segment-line removal-ghost"
                  />
                )}
              </g>

              {/* Draggable handles on every *internal* boundary only -- the
                  first (0) and last (the end) are fixed. */}
              {segments.slice(1).map((seg, idx) => {
                const i = idx + 1;
                if (!inView(x(seg.start_s))) return null;
                return (
                  <g key={i} className="boundary-handle" onPointerDown={(e) => startDrag(e, { kind: "boundary", index: i })}>
                    <line x1={x(seg.start_s)} y1={-4} x2={x(seg.start_s)} y2={PLOT_H + 4} className="boundary-line" />
                    <circle cx={x(seg.start_s)} cy={-4} r={7} />
                  </g>
                );
              })}
            </g>
          </svg>
        </div>

        {/* Where Bobine Audio has its waveforms: the lines themselves, on the
            chart's stretch of time. */}
        <div className="editor-preview">
          <CueLoupe
            analysis={shown}
            duration={duration}
            view={view}
            onView={setView}
            editing={{
              onSplit: (time) => apply(split(history.present, time)),
              onAlign: (i, from, to) => apply(align(history.present, i, from, to)),
            }}
          />
        </div>
      </div>

      {/* Under both, across the editor: the segments' values. */}
      <div className="editor-table-wrap list-scroll">
        <table className="editor-table">
          <thead>
            <tr>
              <th>#</th>
              <th>{t.editor.start}</th>
              <th>{t.editor.end}</th>
              <th title={t.editor.offsetStartHint}>
                {t.editor.offsetStart} <span className="th-unit">(ms)</span>
              </th>
              <th title={t.editor.offsetEndHint}>
                {t.editor.offsetEnd} <span className="th-unit">(ms)</span>
              </th>
              <th title={t.editor.cuesHint}>{t.editor.cues}</th>
              <th>{t.editor.confidence}</th>
              <th>{t.editor.actions}</th>
            </tr>
          </thead>
          <tbody>
            {segments.map((s, i) => (
              <tr key={i} className={s.confidence < LOW_CONFIDENCE ? "editor-row-low-confidence" : undefined}>
                <td>{i + 1}</td>
                <td>
                  {i === 0 ? (
                    clock(0, 2)
                  ) : (
                    <LazyInput
                      label={t.editor.cell(t.editor.start, i + 1)}
                      value={clock(s.start_s, 2)}
                      onCommit={(text) => {
                        const time = parseClock(text);
                        if (time !== null) apply(moveBoundary(segments, i, time));
                      }}
                    />
                  )}
                </td>
                <td className="editor-end-cell">{clock(Math.min(s.end_s, duration), 2)}</td>
                <td>
                  <LazyInput
                    label={t.editor.cell(t.editor.offsetStart, i + 1)}
                    value={msText(s.offset_start)}
                    onCommit={(text) => {
                      const v = Number(text.replace(",", "."));
                      if (isNaN(v)) return;
                      // A constant segment stays constant: both ends move.
                      apply(setOffsets(segments, i, v / 1000, isDrift(s) ? s.offset_end : v / 1000));
                    }}
                  />
                </td>
                <td>
                  <LazyInput
                    label={t.editor.cell(t.editor.offsetEnd, i + 1)}
                    value={msText(s.offset_end)}
                    onCommit={(text) => {
                      const v = Number(text.replace(",", "."));
                      if (!isNaN(v)) apply(setOffsets(segments, i, s.offset_start, v / 1000));
                    }}
                  />
                </td>
                <td className="editor-cues-cell">{cueCounts[i]}</td>
                <td className="editor-confidence-cell" title={t.editor.confidenceHint}>
                  <ConfidenceGauge value={s.confidence} />
                </td>
                <td>
                  <button
                    className="small-button"
                    disabled={segments.length < 2}
                    title={segments.length < 2 ? t.editor.onlySegment : t.editor.removeHint(i + 1, i < segments.length - 1 ? i + 2 : i)}
                    onMouseEnter={() => setRemovalPreview(i)}
                    onMouseLeave={() => setRemovalPreview(null)}
                    onFocus={() => setRemovalPreview(i)}
                    onBlur={() => setRemovalPreview(null)}
                    onClick={() => {
                      setRemovalPreview(null);
                      apply(remove(segments, i));
                    }}
                  >
                    {t.common.remove}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="editor-actions">
        <div className="editor-history">
          <button className="with-icon" onClick={() => setHistory(undo)} disabled={history.past.length === 0} title="Ctrl+Z">
            <UndoIcon />
            {t.editor.undo}
          </button>
          <button className="with-icon" onClick={() => setHistory(redo)} disabled={history.future.length === 0} title="Ctrl+Y">
            <RedoEditIcon />
            {t.editor.redo}
          </button>
          <button onClick={() => apply(analysis.segments)} disabled={!dirty} title={t.editor.resetHint}>
            {t.editor.reset}
          </button>
        </div>
        <button disabled={!unreliable} title={t.editor.removeUnreliableHint} onClick={() => apply(removeUnreliable(segments))}>
          {t.editor.removeUnreliable}
        </button>
        {/* Asks first when edits would be lost (in the header). */}
        <button onClick={requestClose} title={t.editor.cancelHint}>
          {t.common.cancel}
        </button>
        <button
          className="primary-button"
          onClick={() => {
            onSave(history.present);
            onClose();
          }}
        >
          {t.editor.save}
        </button>
      </div>
    </Dialog>
  );
}
