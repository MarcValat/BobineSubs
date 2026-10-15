import { useCallback, useMemo, useRef, useState } from "react";
import type { Analysis } from "./api";
import { clock } from "./format";
import { useT } from "./i18n";
import { CueNavigator } from "./CueNavigator";
import { AlignIcon, ScissorsIcon } from "./icons";
import { InfoTip } from "./InfoTip";
import { lineFates, segmentFor } from "./retime";
import { panView, useDragPan, useWheel, WHEEL_ZOOM_IN_FACTOR, WHEEL_ZOOM_OUT_FACTOR, zoomView, type TimeView } from "./timeView";
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
 * one aligns the first onto the second.
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
  // The lines the export's cleanup changes (those not refused).
  const cleaned = useMemo(() => {
    const skip = new Set(analysis.edits?.skip ?? []);
    return new Set((analysis.cleanup_changes ?? []).map((c) => c.index).filter((i) => !skip.has(i)));
  }, [analysis]);
  // Each line left out of the export, or kept by hand, and why.
  const fates = useMemo(() => new Map(lineFates(analysis).map((f) => [f.index, f.fate])), [analysis]);
  const boundaries = useMemo(() => analysis.segments.slice(1).map((s) => s.start_s), [analysis]);

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
    const byStart = (a: Cue, b: Cue) => a.a - b.a;
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
            const out = fate !== undefined && fate !== "kept";
            return {
              a: c.start,
              b: c.end,
              text: c.text,
              kind: out ? "before out" : "before",
              out: out ? i : undefined,
              note: out ? t.analysis.lines.fates[fate] : undefined,
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
                    kind: `${c.group < 0 ? "after orphan" : "after"}${cleaned.has(target) ? " cleaned" : ""}`,
                    note:
                      [c.group < 0 ? m.noCounterpart : null, cleaned.has(target) ? m.cleaned : null].filter(Boolean).join("\n") ||
                      undefined,
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

  const click = (cue: Cue) => {
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
            {picked === null ? t.editor.alignHint : t.editor.alignPicked(analysis.target_cues[picked]?.text.split("\n").join(" / ") ?? "")}
          </span>
          {picked !== null && (
            <>
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
        {rows.map((row, r) => (
          <div key={row.kind} className={`loupe-row loupe-row-${row.kind}`}>
            <span className="loupe-label">{row.label}</span>
            <div className="loupe-lane" ref={r === 0 ? laneRef : undefined}>
              {boundaries
                .filter((b) => b > start && b < end)
                .map((b) => (
                  <div key={b} className="loupe-boundary" style={{ left: left(b) }} />
                ))}
              {laneWidth > 0 &&
                laneBlocks(row.cues, start, span, laneWidth).map(({ x, w, cue, count }, i) =>
                  cue ? (
                    <div
                      key={i}
                      className={`cue ${cue.kind}${w >= MIN_TEXT_PX ? " labelled" : ""}${cue.target !== undefined && picked === cue.target ? " picked" : ""}${
                        editing && picked !== null && cue.ref !== undefined ? " aim" : ""
                      }`}
                      style={{ left: x, width: w }}
                      title={tip(cue)}
                      onClick={() => click(cue)}
                    >
                      {w >= MIN_TEXT_PX && cue.text.split("\n").join(" / ")}
                    </div>
                  ) : (
                    <div
                      key={i}
                      className={`cue ${row.kind === "reference" ? "ref" : row.kind} merged`}
                      style={{ left: x, width: w }}
                      title={m.lines(count)}
                    />
                  ),
                )}
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
