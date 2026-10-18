import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "./Dropdown.css";

// How long the list takes to fade out (Dropdown.css).
const CLOSE_MS = 120;
// Room kept between the list and its button, and the window's edges.
const GAP_PX = 6;
const EDGE_PX = 8;

/** Every drop-down of the app: a button showing what's picked, opening a
 * list under it (above when there's no room below) that fades in and out.
 * The list is rendered at the end of the page, over everything: a panel or
 * a dialog clipping its content would cut it off. Escape or a click
 * elsewhere closes it (Escape only it, not a dialog it's in); the arrows
 * move between its options. `children` gets `close`, for a pick that ends
 * the choice. */
export function Dropdown({
  label,
  shown,
  badge,
  disabled = false,
  className = "",
  multi = false,
  children,
}: {
  /** What's picked, for a screen reader. */
  label: string;
  /** What the closed button shows. */
  shown: ReactNode;
  /** A count beside it ("2 / 5"). */
  badge?: string | null;
  disabled?: boolean;
  className?: string;
  /** Several options can be picked (the list stays open on a pick). */
  multi?: boolean;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [place, setPlace] = useState<{ left: number; top: number; minWidth: number; above: boolean } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | null>(null);

  function close() {
    if (!open || closing) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setOpen(false);
      return;
    }
    setClosing(true);
    closeTimer.current = window.setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, CLOSE_MS);
  }
  useEffect(
    () => () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    },
    [],
  );

  // Placed under its button, or above when it doesn't fit below; measured
  // hidden first.
  useLayoutEffect(() => {
    if (!open) {
      setPlace(null);
      return;
    }
    const box = button.current?.getBoundingClientRect();
    const height = list.current?.offsetHeight ?? 0;
    const width = list.current?.offsetWidth ?? 0;
    if (!box) return;
    const above = box.bottom + GAP_PX + height > window.innerHeight - EDGE_PX && box.top - GAP_PX - height > EDGE_PX;
    setPlace({
      left: Math.max(EDGE_PX, Math.min(box.left, window.innerWidth - Math.max(width, box.width) - EDGE_PX)),
      top: above ? box.top - GAP_PX - height : box.bottom + GAP_PX,
      minWidth: box.width,
      above,
    });
  }, [open]);

  // Once shown (a hidden element can't take it), the picked option -- or
  // the first -- takes the focus, for the arrows.
  const placed = place !== null;
  useEffect(() => {
    if (!placed) return;
    const picked = list.current?.querySelector<HTMLElement>("[data-option][aria-selected='true']");
    (picked ?? list.current?.querySelector<HTMLElement>("[data-option]"))?.focus({ preventScroll: true });
  }, [placed]);

  // Closes on a click elsewhere, Escape (caught before a dialog's own), a
  // scroll or a resize (it would stay where the button was).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!button.current?.contains(target) && !list.current?.contains(target)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      close();
      button.current?.focus();
    };
    const onMove = (e: Event) => {
      if (!list.current?.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", close);
    };
  });

  /** Up / Down move between the options, Home / End to the ends. */
  function onListKey(e: ReactKeyboardEvent) {
    const options = [...(list.current?.querySelectorAll<HTMLElement>("[data-option]") ?? [])];
    const at = options.indexOf(document.activeElement as HTMLElement);
    const next =
      e.key === "ArrowDown" ? at + 1 : e.key === "ArrowUp" ? at - 1 : e.key === "Home" ? 0 : e.key === "End" ? options.length - 1 : null;
    if (next === null || options.length === 0) return;
    e.preventDefault();
    options[Math.max(0, Math.min(options.length - 1, next))].focus();
  }

  return (
    <>
      <button
        ref={button}
        className={`dropdown-button ${className}${open && !closing ? " open" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open && !closing}
        aria-label={label}
        disabled={disabled}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={(e) => {
          if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="dropdown-shown">{shown}</span>
        {badge && <span className="dropdown-count">{badge}</span>}
        <svg className="dropdown-chevron" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open &&
        createPortal(
          <div
            ref={list}
            className={`dropdown-list${closing ? " closing" : ""}${place?.above ? " above" : ""}`}
            role="listbox"
            aria-label={label}
            aria-multiselectable={multi || undefined}
            onKeyDown={onListKey}
            style={place ? { left: place.left, top: place.top, minWidth: place.minWidth } : { left: 0, top: 0, visibility: "hidden" }}
          >
            {children(close)}
          </div>,
          document.body,
        )}
    </>
  );
}

/** One option of a drop-down: a row with its text, what tells it apart on
 * the right, a check box for one of several (`check`), or the accent for
 * the one picked. */
export function DropdownOption({
  selected,
  check = false,
  label,
  detail,
  onPick,
}: {
  selected: boolean;
  check?: boolean;
  label: ReactNode;
  detail?: ReactNode;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      data-option=""
      aria-selected={selected}
      className={`dropdown-option${selected ? " selected" : ""}`}
      onClick={onPick}
    >
      {check && <span className="dropdown-check" aria-hidden="true" />}
      <span className="dropdown-option-label">{label}</span>
      {detail && <span className="dropdown-detail">{detail}</span>}
    </button>
  );
}

/** A section's title in a list ("NUMÉRO DE PISTE"). */
export function DropdownHeading({ children }: { children: ReactNode }) {
  return <span className="dropdown-heading">{children}</span>;
}

/** The app's single-choice drop-down, in place of a <select>: the options'
 * texts (and a detail beside each, if any); the closed button shows the
 * picked one's. */
export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  placeholder = "—",
  className = "",
}: {
  label: string;
  value: T;
  /** `short`: shown on the closed button instead of `label`, where room
   * is short (the settings bar). */
  options: readonly { value: T; label: string; detail?: string; short?: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
  /** Shown when the value is none of the options. */
  placeholder?: string;
  className?: string;
}) {
  const picked = options.find((o) => o.value === value);
  return (
    <Dropdown
      label={label}
      shown={picked?.short ?? picked?.label ?? placeholder}
      disabled={disabled || options.length === 0}
      className={className}
    >
      {(close) =>
        options.map((o) => (
          <DropdownOption
            key={o.value}
            selected={o.value === value}
            label={o.label}
            detail={o.detail}
            onPick={() => {
              onChange(o.value);
              close();
            }}
          />
        ))
      }
    </Dropdown>
  );
}
