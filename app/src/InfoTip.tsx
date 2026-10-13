import { useEffect, useId, useLayoutEffect, useRef, useState, type FocusEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "./InfoTip.css";
import { useT } from "./i18n";

// Room kept between the bubble and the icon, and the window's edges.
const GAP_PX = 6;
const EDGE_PX = 8;

/** The bubble shown by an InfoTip or a Tooltip while `open`, by `anchor`.
 *
 * Rendered at the end of the page (a portal), not inside the anchor: a
 * panel or dialog that clips its content would otherwise cut it off.
 * Placed below the anchor, or above when there's no room below, and kept
 * inside the window. */
function Bubble({
  anchor,
  open,
  id,
  children,
}: {
  anchor: React.RefObject<HTMLElement | null>;
  open: boolean;
  id?: string;
  children: ReactNode;
}) {
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const box = anchor.current?.getBoundingClientRect();
    const bubble = bubbleRef.current?.getBoundingClientRect();
    if (!box || !bubble) return;
    const left = Math.min(Math.max(EDGE_PX, box.left - 4), window.innerWidth - bubble.width - EDGE_PX);
    const below = box.bottom + GAP_PX;
    const fitsBelow = below + bubble.height <= window.innerHeight - EDGE_PX;
    const top = fitsBelow ? below : Math.max(EDGE_PX, box.top - GAP_PX - bubble.height);
    setPosition({ left, top });
  }, [open, anchor]);

  if (!open) return null;
  return createPortal(
    <span
      ref={bubbleRef}
      id={id}
      className="info-tip-bubble"
      role="tooltip"
      // Measured hidden first, then shown where it fits.
      style={position ? { left: position.left, top: position.top } : { left: 0, top: 0, visibility: "hidden" }}
    >
      {children}
    </span>,
    document.body,
  );
}

/** A bubble's open state and the handlers opening it: on hover, or on
 * keyboard focus only -- a button keeps the focus once clicked, and the
 * window hands it back when it's focused again (after a resize): the
 * bubble mustn't come back then, with the pointer elsewhere. It closes
 * when the window loses the focus. */
function useBubble() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("blur", close);
    return () => window.removeEventListener("blur", close);
  }, [open]);
  return {
    open,
    setOpen,
    handlers: {
      onMouseEnter: () => setOpen(true),
      onMouseLeave: () => setOpen(false),
      onFocus: (e: FocusEvent<HTMLElement>) => {
        if ((e.target as HTMLElement).matches(":focus-visible")) setOpen(true);
      },
      onBlur: () => setOpen(false),
    },
  };
}

/** A small "?" that shows `children` on hover or keyboard focus -- usage
 * hints stay one glance away instead of taking a line of the layout. */
export function InfoTip({ children }: { children: ReactNode }) {
  const t = useT();
  const iconRef = useRef<HTMLSpanElement>(null);
  const bubbleId = useId();
  const { open, handlers } = useBubble();

  // A screen reader hears "Aide" on it, and the bubble's text as its
  // description once it shows.
  return (
    <span
      ref={iconRef}
      className="info-tip"
      tabIndex={0}
      role="button"
      aria-label={t.common.help}
      aria-describedby={open ? bubbleId : undefined}
      {...handlers}
    >
      {/* Drawn, not typed: a glyph sits wherever the font puts it, never
          quite centered in its circle. */}
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <circle className="info-tip-disc" cx="10" cy="10" r="9" />
        <path className="info-tip-mark" d="M7.6 7.7a2.5 2.5 0 0 1 4.85.85c0 1.65-2.45 2.05-2.45 3.7" />
        <circle className="info-tip-dot" cx="10" cy="14.6" r="1.05" />
      </svg>
      <Bubble anchor={iconRef} open={open} id={bubbleId}>
        {children}
      </Bubble>
    </span>
  );
}

/** `text` in the same bubble, on hover or keyboard focus of what it wraps
 * (an icon-only button): at once and in the app's colors, where a native
 * `title` takes a second and looks like the system's. Hovering works on a
 * disabled button too (the wrapper gets it). */
export function Tooltip({ text, children }: { text: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const { open, setOpen, handlers } = useBubble();
  return (
    <span ref={ref} className="tooltip-anchor" {...handlers} onClick={() => setOpen(false)}>
      {children}
      <Bubble anchor={ref} open={open}>
        {text}
      </Bubble>
    </span>
  );
}
