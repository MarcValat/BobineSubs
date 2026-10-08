import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "./InfoTip.css";

// Room kept between the bubble and the icon, and the window's edges.
const GAP_PX = 6;
const EDGE_PX = 8;

/** A small "?" that shows `children` on hover or keyboard focus -- usage
 * hints stay one glance away instead of taking a line of the layout.
 *
 * The bubble is rendered at the end of the page (a portal), not inside the
 * icon: a panel or dialog that clips its content would otherwise cut it
 * off. Placed below the icon, or above when there's no room below, and
 * kept inside the window. From Bobine Audio. */
export function InfoTip({ children }: { children: ReactNode }) {
  const iconRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const icon = iconRef.current?.getBoundingClientRect();
    const bubble = bubbleRef.current?.getBoundingClientRect();
    if (!icon || !bubble) return;
    const left = Math.min(Math.max(EDGE_PX, icon.left - 4), window.innerWidth - bubble.width - EDGE_PX);
    const below = icon.bottom + GAP_PX;
    const fitsBelow = below + bubble.height <= window.innerHeight - EDGE_PX;
    const top = fitsBelow ? below : Math.max(EDGE_PX, icon.top - GAP_PX - bubble.height);
    setPosition({ left, top });
  }, [open]);

  return (
    <span
      ref={iconRef}
      className="info-tip"
      tabIndex={0}
      aria-label="Aide"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      ?
      {open &&
        createPortal(
          <span
            ref={bubbleRef}
            className="info-tip-bubble"
            role="tooltip"
            // Measured hidden first, then shown where it fits.
            style={position ? { left: position.left, top: position.top } : { left: 0, top: 0, visibility: "hidden" }}
          >
            {children}
          </span>,
          document.body,
        )}
    </span>
  );
}
