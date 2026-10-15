import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Analysis } from "./api";
import { clock } from "./format";
import { useT } from "./i18n";
import { CueNavigator } from "./CueNavigator";
import { AlignIcon, ScissorsIcon } from "./icons";
import { InfoTip } from "./InfoTip";
import { isOut, lineFates, MIN_LINE_S, segmentFor } from "./retime";
import {
  DRAG_THRESHOLD_PX,
  panView,
  useDragPan,
  useWheel,
  WHEEL_ZOOM_IN_FACTOR,
  WHEEL_ZOOM_OUT_FACTOR,
  zoomView,
  type TimeView,
} from "./timeView";
import { useElementSize } from "./useElementSize";
import "./CueLoupe.css";

/** The zoom buttons' stretches (seconds). */
const ZOOMS = [10, 30, 60, 120];
const DEFAULT_ZOOM = 30;

/** Where an analysis' loupe opens: its first reference line, at 30 s. */
function initialView(analysis: Analysis, duration: number): TimeView {
  const span = Math.min(DEFAULT_ZOOM, duration);
  const start = Math.max(0, Math.min((analysis.reference_cues[0]?.[0] ?? 0) - 2, duration - span));
  return { start, duration: span };
}

/** The loupe's stretch of an analysis, shared with the chart framing it;
 * back to the start for another one (`key`: the file and track shown). */
export function useCueView(key: string, analysis: Analysis | null | undefined, duration: number): [TimeView, (view: TimeView) => void] {
  const [state, setState] = useState<{ key: string; view: TimeView } | null>(null);
  const view = state?.key === key ? state.view : analysis ? initialView(analysis, duration) : { start: 0, duration: DEFAULT_ZOOM };
  return [view, (next) => setState({ key, view: next })];
}

/** What the loupe can change when it's in the segment editor. */
export interface LoupeEditing {
  /** Split the segment at `time` (the loupe's middle). */
  onSplit: (time: number) => void;
  /** Move segment `i` so that target time `from` lands on reference time `to`. */
  onAlign: (i: number, from: number, to: number) => void;
  /** Line `index` of the target kept, taken out, or as the analysis has it. */
  onLine: (index: number, change: "keep" | "drop" | "reset") => void;
  /** Line `index` of the target given `times` by hand (reference time), or
   * back to its segment's (null). */
  onTiming: (index: number, times: [number, number] | null) => void;
}

export interface Cue {
  a: number;
  b: number;
  text: string;
  kind: string;
  /** Under the pointer, besides its times and text. */
  note?: string;
  /** A line of the target left out of the export ("Avant" row: its index). */
  out?: number;
  /** The target cue it is (the "Après" row), the reference cue it is. */
  target?: number;
  ref?: number;
}

/** What a drag of a picked line changes: its start, its end, or both. */
export type TimingDrag = "start" | "end" | "move";

/** Closer than this (px), a line's edge dragged lands on a reference line's. */
const SNAP_PX = 6;

/** A line [a, b] once its `mode` is dragged by `delta` seconds: an edge
 * dragged lands on the nearest of `snaps` within `tolerance` (seconds), as
 * the nearer of its two edges for a line moved; the line no shorter than
 * MIN_LINE_S, within 0..`duration`. */
export function dragTimes(
  mode: TimingDrag,
  a: number,
  b: number,
  delta: number,
  snaps: readonly number[],
  tolerance: number,
  duration: number,
): [number, number] {
  // How far `t` is from the snap it lands on (Infinity: none near enough).
  const pull = (t: number) => {
    let best = Infinity;
    for (const s of snaps) if (Math.abs(s - t) <= tolerance && Math.abs(s - t) < Math.abs(best)) best = s - t;
    return best;
  };
  const snapped = (t: number) => {
    const d = pull(t);
    return Number.isFinite(d) ? t + d : t;
  };
  if (mode === "start") return [Math.max(0, Math.min(snapped(a + delta), b - MIN_LINE_S)), b];
  if (mode === "end") return [a, Math.min(Math.max(duration, b), Math.max(snapped(b + delta), a + MIN_LINE_S))];
  const length = b - a;
  const [ps, pe] = [pull(a + delta), pull(b + delta)];
  const shift = Math.abs(ps) <= Math.abs(pe) ? ps : pe;
  const start = Math.max(0, Math.min(a + delta + (Number.isFinite(shift) ? shift : 0), Math.max(0, duration - length)));
  return [start, start + length];
}

const byStart = (a: Cue, b: Cue) => a.a - b.a;

/** Closer than this (px), two lines too narrow to read are one block. */
const MERGE_GAP_PX = 2;
/** Narrower than this (px), a line shows no text: it would only be "…". */
const MIN_TEXT_PX = 28;

/** What a lane draws, `width` px wide for `span` seconds from `start`
 * (`cues` by start time): each line in view, as wide as it lasts -- except
 * lines too narrow to read and that close together (zoomed out), drawn as
 * one block of `count` lines: a whole episode is a few hundred blocks, not
 * a thousand lines of text redrawn at every notch of the wheel. A line
 * across the lane's edge is cut there. */
export function laneBlocks(
  cues: Cue[],
  start: number,
  span: number,
  width: number,
): { x: number; w: number; cue: Cue | null; count: number }[] {
  const px = (t: number) => ((t - start) / span) * width;
  const blocks: { x: number; w: number; cue: Cue | null; count: number }[] = [];
  for (const cue of cues) {
    if (cue.b <= start || cue.a >= start + span) continue;
    const x = px(cue.a);
    const w = Math.max(0, px(cue.b) - x);
    const last = blocks[blocks.length - 1];
    if (last && w < MIN_TEXT_PX && last.w < MIN_TEXT_PX && x - (last.x + last.w) < MERGE_GAP_PX) {
      last.w = Math.max(last.w, x + w - last.x);
      last.count += 1;
      last.cue = null;
    } else {
      blocks.push({ x, w, cue, count: 1 });
    }
  }
  // Within the lane: a line across its edge is cut there.
  return blocks.map((b) => {
    const left = Math.max(0, b.x);
    return { ...b, x: left, w: Math.max(0, Math.min(width, b.x + b.w) - left) };
  });
}

/**
 * The cues themselves, close up: the reference's, then those to correct
 * before and after the correction, on one time axis -- where Bobine Audio
 * shows its waveforms. The wheel zooms under the pointer, a drag moves
 * through time (timeView.ts, as Audio's waveforms), the buttons jump from
 * one segment's boundary to the next or set the zoom. In the segment
 * editor (`editing`), "Couper ici", and a cue of "Après" then a reference
 * one aligns the first onto the second; the cue picked has its edges
 * dragged to change its start or end, itself to move it (by hand: see
 * dragTimes).
 */
export function CueLoupe({
  analysis,
  duration,
  view,
  onView,
  editing,
}: {
  analysis: Analysis;
  duration: number;
  view: TimeView;
  onView: (view: TimeView) => void;
  editing?: LoupeEditing;
}) {
  const t = useT();
  const m = t.loupe;
  const lanes = useRef<HTMLDivElement>(null);
  const lane = useRef<HTMLDivElement>(null);
  // Align tool: the target cue picked first ("Après" row); a line left out
  // of the export picked ("Avant" row), to keep it or put it back.
  const [picked, setPicked] = useState<number | null>(null);
  const [outPicked, setOutPicked] = useState<number | null>(null);
  // The line picked, while its edge or itself is dragged: where it is.
  const [drag, setDrag] = useState<{ index: number; a: number; b: number } | null>(null);
  // A drag of the line picked ended: not a click on it too.
  const timingDragged = useRef(false);

  // Delete (outside a field): the line picked taken out of the export.
  const onLine = editing?.onLine;
  useEffect(() => {
    if (picked === null || !onLine) return;
    const onKey = (e: KeyboardEvent) => {
      const field =
        e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
      if (e.key !== "Delete" || field || e.ctrlKey || e.altKey || e.metaKey) return;
      e.preventDefault();
      onLine(picked, "drop");
      setPicked(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picked, onLine]);
  // The lines the export's cleanup changes (those not refused).
  const cleaned = useMemo(() => {
    const skip = new Set(analysis.edits?.skip ?? []);
    return new Set((analysis.cleanup_changes ?? []).map((c) => c.index).filter((i) => !skip.has(i)));
  }, [analysis]);
  // Each line left out of the export, or kept by hand, and why.
  const fates = useMemo(() => new Map(lineFates(analysis).map((f) => [f.index, f.fate])), [analysis]);
  const boundaries = useMemo(() => analysis.segments.slice(1).map((s) => s.start_s), [analysis]);
  // Where a line's edge dragged lands: the reference lines' edges.
  const snaps = useMemo(() => analysis.reference_cues.flatMap(([a, b]) => [a, b]), [analysis]);

  const start = view.start;
  const end = view.start + view.duration;
  const centre = start + view.duration / 2;

  const pan = useDragPan(lanes, (share) => onView(panView(view, share * view.duration, duration)));

  /** Scroll up zooms in, scroll down zooms out, anchored under the cursor
   * (the same convention as a map), without scrolling the surrounding
   * panel. The notches of one frame make one zoom: one redraw. */
  const latest = useRef({ view, onView, duration });
  latest.current = { view, onView, duration };
  const pendingZoom = useRef<{ factor: number; anchor: number } | null>(null);
  useWheel(lanes, (e) => {
    const rect = lane.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || view.duration <= 0) return;
    const factor = e.deltaY < 0 ? WHEEL_ZOOM_IN_FACTOR : WHEEL_ZOOM_OUT_FACTOR;
    if (pendingZoom.current) {
      pendingZoom.current.factor *= factor;
      return;
    }
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    pendingZoom.current = { factor, anchor: start + frac * view.duration };
    requestAnimationFrame(() => {
      const zoom = pendingZoom.current;
      pendingZoom.current = null;
      if (!zoom) return;
      const now = latest.current;
      now.onView(zoomView(now.view, zoom.factor, zoom.anchor, now.duration));
    });
  });

  /** `seconds` long around the loupe's middle (a zoom button). */
  function zoomTo(seconds: number) {
    const span = Math.min(seconds, duration);
    onView({ start: Math.max(0, Math.min(centre - span / 2, duration - span)), duration: span });
  }

  /** The loupe's middle on `time` (a jump). */
  function centreOn(time: number) {
    onView({ start: Math.max(0, Math.min(time - view.duration / 2, duration - view.duration)), duration: view.duration });
  }

  const goToJump = (direction: 1 | -1) => {
    const next = direction > 0 ? boundaries.find((b) => b > centre + 0.01) : [...boundaries].reverse().find((b) => b < centre - 0.01);
    if (next !== undefined) centreOn(next);
  };

  const span = view.duration;
  const left = (time: number) => `${((time - start) / span) * 100}%`;
  const range = (a: number, b: number) => `${clock(a, 2)} → ${clock(b, 2)}`;

  // Every line of each row, by start time: made once per analysis, the
  // view only picks among them.
  const rows: { label: string; kind: string; cues: Cue[] }[] = useMemo(() => {
    return [
      {
        label: m.reference,
        kind: "reference",
        cues: analysis.reference_cues.map(([a, b, text], ref) => ({ a, b, text, ref, kind: "ref" })).sort(byStart),
      },
      {
        label: m.before,
        kind: "before",
        // Those left out of the export marked (see lineFates).
        cues: analysis.target_cues
          .map((c, i) => {
            const fate = fates.get(i);
            const out = isOut(fate);
            return {
              a: c.start,
              b: c.end,
              text: c.text,
              kind: out ? "before out" : "before",
              out: out ? i : undefined,
              note: out ? t.analysis.lines.fates[fate!] : undefined,
            };
          })
          .sort(byStart),
      },
      {
        label: m.after,
        kind: "after",
        cues: analysis.target_cues
          .flatMap((c, target) =>
            c.corrected
              ? [
                  {
                    a: c.corrected[0],
                    b: c.corrected[1],
                    text: c.text,
                    target,
                    kind: `${c.group < 0 ? "after orphan" : "after"}${cleaned.has(target) ? " cleaned" : ""}${
                      fates.get(target) === "timed" ? " timed" : ""
                    }`,
                    note:
                      [
                        c.group < 0 ? m.noCounterpart : null,
                        cleaned.has(target) ? m.cleaned : null,
                        fates.get(target) === "timed" ? m.timed : null,
                      ]
                        .filter(Boolean)
                        .join("\n") || undefined,
                  },
                ]
              : [],
          )
          .sort(byStart),
      },
    ];
  }, [analysis, m, fates, t, cleaned]);
  // The navigator's bars: the reference's lines, the corrected ones.
  const spans = useMemo(
    () => ({
      reference: analysis.reference_cues.map(([a, b]) => [a, b] as const),
      corrected: analysis.target_cues.flatMap((c) => (c.corrected ? [c.corrected] : [])),
    }),
    [analysis],
  );
  // The lanes' width, for the lines too narrow to read (see laneBlocks).
  const [measure, { width: laneWidth }] = useElementSize<HTMLDivElement>();
  const laneRef = useCallback(
    (el: HTMLDivElement | null) => {
      lane.current = el;
      measure(el);
    },
    [measure],
  );
  const tip = (c: Cue) => [range(c.a, c.b), c.text, c.note].filter(Boolean).join("\n");

  // While the line picked is dragged: there, in the "Après" row.
  const shown = drag
    ? rows.map((row) =>
        row.kind === "after"
          ? { ...row, cues: row.cues.map((c) => (c.target === drag.index ? { ...c, a: drag.a, b: drag.b } : c)).sort(byStart) }
          : row,
      )
    : rows;

  /** A press on the line picked: its edge (`mode` "start", "end") or
   * itself dragged, its new times given once it's let go (one step to
   * undo); a press that doesn't move is a click. */
  function startTiming(e: ReactPointerEvent, cue: Cue, mode: TimingDrag) {
    if (!editing || cue.target === undefined || e.button !== 0) return;
    // Not a drag of the view too.
    e.stopPropagation();
    const width = lane.current?.getBoundingClientRect().width ?? 0;
    if (width <= 0) return;
    const onTiming = editing.onTiming;
    const index = cue.target;
    const perPx = span / width;
    const x0 = e.clientX;
    let times: [number, number] | null = null;
    timingDragged.current = false;
    const move = (ev: PointerEvent) => {
      if (!times && Math.abs(ev.clientX - x0) < DRAG_THRESHOLD_PX) return;
      if (!times) document.documentElement.classList.add(mode === "move" ? "line-moving" : "line-resizing");
      times = dragTimes(mode, cue.a, cue.b, (ev.clientX - x0) * perPx, ev.altKey ? [] : snaps, SNAP_PX * perPx, duration);
      setDrag({ index, a: times[0], b: times[1] });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      document.documentElement.classList.remove("line-moving", "line-resizing");
      setDrag(null);
      if (times) {
        timingDragged.current = true;
        onTiming(index, times);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  const click = (cue: Cue) => {
    if (timingDragged.current) {
      timingDragged.current = false;
      return;
    }
    if (!editing || pan.dragged.current) return;
    if (cue.out !== undefined) {
      setOutPicked(outPicked === cue.out ? null : cue.out);
      setPicked(null);
    } else if (cue.target !== undefined) {
      setPicked(picked === cue.target ? null : cue.target);
      setOutPicked(null);
    } else if (cue.ref !== undefined && picked !== null) {
      const tc = analysis.target_cues[picked];
      const i = segmentFor((tc.start + tc.end) / 2, analysis.segments);
      if (i !== null) editing.onAlign(i, tc.start, cue.a);
      setPicked(null);
    }
  };

  return (
    <div className="loupe">
      <div className="loupe-toolbar">
        <div className="button-group">
          <span className="toolbar-label">{m.goTo}</span>
          <button className="small-button" onClick={() => goToJump(-1)} disabled={!boundaries.some((b) => b < centre - 0.01)}>
            {m.previousJump}
          </button>
          <button className="small-button" onClick={() => goToJump(1)} disabled={!boundaries.some((b) => b > centre + 0.01)}>
            {m.nextJump}
          </button>
          {editing && (
            <button className="small-button with-icon" onClick={() => editing.onSplit(centre)} title={t.editor.splitHint}>
              <ScissorsIcon />
              {t.editor.split}
            </button>
          )}
        </div>
        <span className="loupe-window">
          {clock(start, 0)} – {clock(end, 0)}
        </span>
        <div className="button-group">
          <span className="toolbar-label">{m.zoom}</span>
          {ZOOMS.map((z) => (
            <button
              key={z}
              className={Math.abs(view.duration - Math.min(z, duration)) < 0.05 ? "small-button primary-button" : "small-button"}
              aria-pressed={Math.abs(view.duration - Math.min(z, duration)) < 0.05}
              onClick={() => zoomTo(z)}
            >
              {z < 60 ? `${z} s` : `${z / 60} min`}
            </button>
          ))}
          <InfoTip>{m.zoomHint}</InfoTip>
        </div>
      </div>
      {/* Aligner: what to click, then the line picked and how to drop it. */}
      {editing && (
        <div className={`align-banner${picked !== null ? " picked" : ""}`}>
          <AlignIcon />
          <span>
            <b>{t.common.labelled(t.editor.align)}</b>{" "}
            {picked === null
              ? t.editor.alignHint
              : drag
                ? t.editor.timingDrag(range(drag.a, drag.b), `${(drag.b - drag.a).toFixed(2)} s`)
                : t.editor.alignPicked(analysis.target_cues[picked]?.text.split("\n").join(" / ") ?? "")}
          </span>
          {picked !== null && (
            <>
              {fates.get(picked) === "timed" && (
                <button className="small-button" onClick={() => editing.onTiming(picked, null)}>
                  {t.editor.untimeLine}
                </button>
              )}
              <button
                className="small-button"
                onClick={() => {
                  editing.onLine(picked, fates.get(picked) === "kept" ? "reset" : "drop");
                  setPicked(null);
                }}
              >
                {fates.get(picked) === "kept" ? t.editor.unkeepLine : t.editor.dropLine}
              </button>
              <button className="small-button" onClick={() => setPicked(null)}>
                {t.editor.alignCancel}
              </button>
            </>
          )}
        </div>
      )}
      {/* A line left out of the export, picked in "Avant": kept, or put back. */}
      {editing && outPicked !== null && fates.has(outPicked) && (
        <div className="align-banner picked">
          <span>
            {t.editor.lineOut(analysis.target_cues[outPicked].text.split("\n").join(" / "), t.analysis.lines.fates[fates.get(outPicked)!])}
          </span>
          {fates.get(outPicked) !== "start" && (
            <button
              className="small-button"
              onClick={() => {
                editing.onLine(outPicked, fates.get(outPicked) === "gap" ? "keep" : "reset");
                setOutPicked(null);
              }}
            >
              {fates.get(outPicked) === "gap" ? t.editor.keepLine : t.editor.restoreLine}
            </button>
          )}
          <button className="small-button" onClick={() => setOutPicked(null)}>
            {t.common.cancel}
          </button>
        </div>
      )}
      <div
        ref={lanes}
        className={`loupe-lanes${editing ? " clickable" : ""}`}
        role="group"
        aria-label={m.ariaLabel}
        onPointerDown={pan.onPointerDown}
        onMouseDown={pan.onMouseDown}
      >
        {shown.map((row, r) => (
          <div key={row.kind} className={`loupe-row loupe-row-${row.kind}`}>
            <span className="loupe-label">{row.label}</span>
            <div className="loupe-lane" ref={r === 0 ? laneRef : undefined}>
              {boundaries
                .filter((b) => b > start && b < end)
                .map((b) => (
                  <div key={b} className="loupe-boundary" style={{ left: left(b) }} />
                ))}
              {laneWidth > 0 &&
                laneBlocks(row.cues, start, span, laneWidth).map(({ x, w, cue, count }, i) => {
                  if (!cue)
                    return (
                      <div
                        key={i}
                        className={`cue ${row.kind === "reference" ? "ref" : row.kind} merged`}
                        style={{ left: x, width: w }}
                        title={m.lines(count)}
                      />
                    );
                  // The line picked, in the editor: its edges and itself dragged.
                  const timing = !!editing && cue.target !== undefined && picked === cue.target;
                  const handle = (mode: "start" | "end") => (
                    <span
                      className={`cue-handle ${mode}`}
                      title={mode === "start" ? t.editor.timingStart : t.editor.timingEnd}
                      onPointerDown={(e) => startTiming(e, cue, mode)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  );
                  return (
                    <div
                      key={i}
                      className={`cue ${cue.kind}${w >= MIN_TEXT_PX ? " labelled" : ""}${timing ? " picked" : ""}${
                        editing && picked !== null && cue.ref !== undefined ? " aim" : ""
                      }`}
                      style={{ left: x, width: w }}
                      title={tip(cue)}
                      onPointerDown={timing ? (e) => startTiming(e, cue, "move") : undefined}
                      onClick={() => click(cue)}
                    >
                      {w >= MIN_TEXT_PX && cue.text.split("\n").join(" / ")}
                      {/* Not at an edge the lane cuts. */}
                      {timing && cue.a >= start && handle("start")}
                      {timing && cue.b <= end && handle("end")}
                    </div>
                  );
                })}
            </div>
          </div>
        ))}
      </div>
      {/* In the editor, whose chart zooms with the loupe: the whole episode
          at a glance (the detail's chart frames the loupe itself). */}
      {editing && (
        <CueNavigator
          duration={duration}
          viewStart={view.start}
          viewDuration={view.duration}
          reference={spans.reference}
          corrected={spans.corrected}
          onNavigate={(next) => onView({ start: next, duration: view.duration })}
        />
      )}
    </div>
  );
}
