import { useEffect, useRef, type ReactNode, type Ref } from "react";
import "./Dialog.css";

/** Escape runs `onEscape` (the latest one, however often it changes). */
export function useEscape(onEscape: () => void): void {
  const latest = useRef(onEscape);
  latest.current = onEscape;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      latest.current();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/** A window over the whole app, on a dimmed backdrop: "Choisir",
 * "Vérifier toutes les pistes", Options, the segment editor.
 *
 * Escape runs `onEscape` (default: `onClose`); a click on the backdrop
 * closes it only with `closeOnBackdrop` -- not where a stray click would
 * lose a choice in progress. `fill` takes the whole window (the editor);
 * otherwise it's as big as its content, scrolling past the window's height. */
export function Dialog({
  onClose,
  onEscape,
  closeOnBackdrop = false,
  fill = false,
  className = "",
  labelledBy,
  panelRef,
  children,
}: {
  onClose: () => void;
  onEscape?: () => void;
  closeOnBackdrop?: boolean;
  fill?: boolean;
  className?: string;
  labelledBy?: string;
  panelRef?: Ref<HTMLDivElement>;
  children: ReactNode;
}) {
  useEscape(onEscape ?? onClose);
  return (
    <div
      className={`dialog-overlay${fill ? " dialog-overlay-fill" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      onClick={closeOnBackdrop ? onClose : undefined}
    >
      <div
        ref={panelRef}
        className={`dialog-panel${fill ? " dialog-panel-fill" : ""} ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

/** A dialog's title row: the title, then `children` (tabs...), then its
 * close button when `onClose` is given (a dialog with its own way out
 * passes that as a child instead). */
export function DialogHeader({
  id,
  title,
  titleTooltip,
  onClose,
  closeLabel,
  children,
}: {
  id?: string;
  title: ReactNode;
  titleTooltip?: string;
  onClose?: () => void;
  closeLabel?: string;
  children?: ReactNode;
}) {
  return (
    <div className="dialog-header">
      <h2 id={id} title={titleTooltip}>
        {title}
      </h2>
      {children}
      {onClose && (
        <button className="small-button" onClick={onClose}>
          {closeLabel ?? "Fermer"}
        </button>
      )}
    </div>
  );
}
