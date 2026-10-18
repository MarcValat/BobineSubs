import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "./i18n";

const WIDTH = 860;
const HEIGHT = 30;
// Wide enough to always grab, even when the current view is a tiny sliver
// of a long episode -- a window narrower than this would be near-impossible
// to click/drag precisely.
const MIN_WINDOW_PX = 6;
// Columns drawn: enough to see the scenes, few enough to stay light.
const COLUMNS = 400;

/** How much of each of COLUMNS columns of [0, duration] `cues` cover, as a
 * path of bars `height` high at most, from `y` down. */
export function densityPath(cues: readonly (readonly [number, number])[], duration: number, y: number, height: number): string {
  if (duration <= 0) return "";
  const column = duration / COLUMNS;
  const covered = new Array<number>(COLUMNS).fill(0);
  for (const [a, b] of cues) {
    const lo = Math.max(0, a);
    const hi = Math.min(duration, b);
    for (let k = Math.floor(lo / column); k < COLUMNS && k * column < hi; k++) {
      covered[k] += Math.max(0, Math.min(hi, (k + 1) * column) - Math.max(lo, k * column));
    }
  }
  const w = WIDTH / COLUMNS;
  return covered
    .map((c, k) => {
      const h = Math.min(1, c / column) * height;
      return h > 0 ? `M${(k * w).toFixed(1)} ${(y + height - h).toFixed(1)}h${w.toFixed(2)}v${h.toFixed(1)}h${(-w).toFixed(2)}z` : "";
    })
    .join("");
}

/** A whole-episode overview bar below the loupe, from Bobine Audio's
 * WaveformNavigator: drag the highlighted window to move through time
 * without a dezoom-then-rezoom round trip, or click anywhere else on the
 * bar to take the loupe there. Where Audio draws the track's waveform, the
 * lines: the reference's above, the corrected ones below. */
export function CueNavigator({
  duration,
  viewStart,
  viewDuration,
  reference,
  corrected,
  onNavigate,
}: {
  duration: number;
  viewStart: number;
  viewDuration: number;
  reference: readonly (readonly [number, number])[];
  corrected: readonly (readonly [number, number])[];
  /** Pan only -- the window's width always mirrors the current zoom, set
   * elsewhere (the zoom buttons, the wheel); this only moves where it starts. */
  onNavigate: (viewStart: number) => void;
}) {
  const t = useT();
  const svgRef = useRef<SVGSVGElement>(null);
  // Anchors the drag to where it *started*, not the live pointer position,
  // so the window pans by exactly the pointer's movement instead of
  // snapping its near edge to the cursor on the first pixel of movement.
  const [drag, setDrag] = useState<{ startClientX: number; startViewStart: number } | null>(null);

  const clampStart = (s: number) => Math.max(0, Math.min(Math.max(0, duration - viewDuration), s));
  const timeToX = (time: number) => (duration > 0 ? (time / duration) * WIDTH : 0);

  useEffect(() => {
    if (!drag) return;
    function onMove(e: PointerEvent) {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect || !drag) return;
      const deltaFrac = (e.clientX - drag.startClientX) / rect.width;
      onNavigate(clampStart(drag.startViewStart + deltaFrac * duration));
    }
    function onUp() {
      setDrag(null);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag]);

  function handleWindowPointerDown(e: React.PointerEvent<SVGRectElement>) {
    // No text selection while dragging, nor the loupe's own pan.
    e.preventDefault();
    e.stopPropagation();
    setDrag({ startClientX: e.clientX, startViewStart: viewStart });
  }

  function handleBackgroundClick(e: React.MouseEvent<SVGSVGElement>) {
    if (!svgRef.current || duration <= 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onNavigate(clampStart(frac * duration - viewDuration / 2));
  }

  // Once per analysis, not at every render (each move of the view renders it).
  const referencePath = useMemo(() => densityPath(reference, duration, 2, HEIGHT / 2 - 3), [reference, duration]);
  const correctedPath = useMemo(() => densityPath(corrected, duration, HEIGHT / 2 + 1, HEIGHT / 2 - 3), [corrected, duration]);
  const winX0 = Math.max(0, timeToX(viewStart));
  const winX1raw = Math.min(WIDTH, timeToX(viewStart + viewDuration));
  const winX1 = Math.max(winX1raw, winX0 + MIN_WINDOW_PX);

  return (
    <div className="cue-navigator">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        className="cue-navigator-svg"
        onClick={handleBackgroundClick}
        onPointerDown={(e) => e.stopPropagation()}
        role="img"
        aria-label={t.loupe.navigator}
      >
        <path d={referencePath} className="cue-navigator-reference" />
        <path d={correctedPath} className="cue-navigator-corrected" />
        <rect
          x={winX0}
          y={0}
          width={winX1 - winX0}
          height={HEIGHT}
          className="cue-navigator-window"
          onPointerDown={handleWindowPointerDown}
          onClick={(e) => e.stopPropagation()}
        />
      </svg>
    </div>
  );
}
