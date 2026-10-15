import { useEffect, useRef, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

/** The stretch of the timeline on screen, shared by the cue loupe and the
 * chart above it (its frame), so zooming or panning either moves both.
 * From Bobine Audio. */
export interface TimeView {
  start: number;
  duration: number;
}

// Close enough to tell a cue's start from the next one's by eye.
export const MIN_VIEW_DURATION_S = 5;

export const WHEEL_ZOOM_IN_FACTOR = 0.85;
export const WHEEL_ZOOM_OUT_FACTOR = 1 / WHEEL_ZOOM_IN_FACTOR;

/** `view` zoomed by `factor` (< 1 in, > 1 out) keeping `centerTime` at the
 * same place on screen, within [0, total]. */
export function zoomView(view: TimeView, factor: number, centerTime: number, total: number): TimeView {
  const duration = Math.max(Math.min(MIN_VIEW_DURATION_S, total), Math.min(total, view.duration * factor));
  const frac = view.duration > 0 ? (centerTime - view.start) / view.duration : 0.5;
  const start = Math.max(0, Math.min(Math.max(0, total - duration), centerTime - frac * duration));
  return { start, duration };
}

/** Calls `onWheel` for wheel events on `ref`'s element, with the page's own
 * scrolling blocked. React registers wheel listeners as passive, where
 * preventDefault() is ignored: the surrounding panel would scroll while
 * zooming. */
export function useWheel(ref: RefObject<Element | null>, onWheel: (e: WheelEvent) => void): void {
  const handler = useRef(onWheel);
  handler.current = onWheel;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const listener = (e: Event) => {
      e.preventDefault();
      handler.current(e as WheelEvent);
    };
    el.addEventListener("wheel", listener, { passive: false });
    return () => el.removeEventListener("wheel", listener);
  }, [ref]);
}

/** `view` moved by `delta` seconds, within [0, total]. */
export function panView(view: TimeView, delta: number, total: number): TimeView {
  return { start: Math.max(0, Math.min(Math.max(0, total - view.duration), view.start + delta)), duration: view.duration };
}

// A press that moves less than this is a click, not a drag.
export const DRAG_THRESHOLD_PX = 4;

/** A drag on a timeline (the cue loupe) moves the view with the pointer,
 * as a map: `onPan` by a share of the element's width (the caller turns it
 * into seconds), the left or the middle button. A press that doesn't move
 * stays a click, for the element under the pointer (a cue): `dragged`
 * tells the click ending a drag apart. Bobine Audio's useTimelinePointer
 * without its playback position. Returns the element's onPointerDown, and
 * its onMouseDown (it stops the middle button's autoscroll). */
export function useDragPan(ref: RefObject<Element | null>, onPan: (share: number) => void) {
  const latest = useRef(onPan);
  latest.current = onPan;
  const dragged = useRef(false);

  function onPointerDown(e: ReactPointerEvent) {
    if (e.button !== 0 && e.button !== 1) return;
    if (e.button === 1) e.preventDefault();
    const startX = e.clientX;
    let lastX = e.clientX;
    let dragging = false;
    dragged.current = false;
    const move = (ev: PointerEvent) => {
      if (!dragging && Math.abs(ev.clientX - startX) < DRAG_THRESHOLD_PX) return;
      if (!dragging) {
        dragging = true;
        dragged.current = true;
        document.documentElement.classList.add("timeline-panning");
      }
      const width = ref.current?.getBoundingClientRect().width ?? 0;
      if (width > 0) latest.current(-(ev.clientX - lastX) / width);
      lastX = ev.clientX;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      document.documentElement.classList.remove("timeline-panning");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  return {
    dragged,
    onPointerDown,
    onMouseDown: (e: ReactMouseEvent) => {
      if (e.button === 1) e.preventDefault();
    },
  };
}
