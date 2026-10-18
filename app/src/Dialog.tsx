import { useEffect, useRef, type ReactNode, type Ref } from "react";
import "./Dialog.css";
import { useT } from "./i18n";
import { CloseIcon } from "./icons";
import { Tooltip } from "./InfoTip";

/** Escape runs `onEscape` (the latest one, however often it changes). */
function useEscape(onEscape: () => void): void {
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

/** A window over the whole app, on a dimmed backdrop: the subtitles'
 * "Changer", "Vérifier toutes les pistes", the log, Paramètres, the segment
 * editor.
 *
 * Escape runs `onEscape` (default: `onClose`); a click on the backdrop
 * closes it only with `closeOnBackdrop` -- not where a stray click would
 * lose a choice in progress. `fill` takes the whole window (the editor);
 * `side` slides in from the right under the top bar (Paramètres), and
 * back out while `closing` (its owner removes it once that's played);
 * otherwise it's as big as its content, scrolling past the window's height. */
export function Dialog({
  onClose,
  onEscape,
  closeOnBackdrop = false,
  fill = false,
  side = false,
  closing = false,
  className = "",
  labelledBy,
  panelRef,
  children,
}: {
  onClose: () => void;
  onEscape?: () => void;
  closeOnBackdrop?: boolean;
  fill?: boolean;
  side?: boolean;
  closing?: boolean;
  className?: string;
  labelledBy?: string;
  panelRef?: Ref<HTMLDivElement>;
  children: ReactNode;
}) {
  useEscape(onEscape ?? onClose);
  return (
    <div
      className={`dialog-overlay${fill ? " dialog-overlay-fill" : ""}${side ? " dialog-overlay-side" : ""}${closing ? " dialog-closing" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      onClick={closeOnBackdrop ? onClose : undefined}
    >
      <div
        ref={panelRef}
        className={`dialog-panel${fill ? " dialog-panel-fill" : ""}${side ? " dialog-panel-side" : ""} ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

/** A dialog's title row: the title, then `children` (tabs...), then its
 * close button when `onClose` is given (a dialog with its own way out
 * passes that as a child instead): the same cross at the far right in
 * every dialog and in the settings drawer. */
export function DialogHeader({
  id,
  title,
  titleTooltip,
  onClose,
  children,
}: {
  id?: string;
  title: ReactNode;
  titleTooltip?: string;
  onClose?: () => void;
  children?: ReactNode;
}) {
  const t = useT();
  return (
    <div className="dialog-header">
      <h2 id={id} title={titleTooltip}>
        {title}
      </h2>
      {children}
      {onClose && (
        <Tooltip text={t.common.close}>
          <button className="icon-button dialog-close" aria-label={t.common.close} onClick={onClose}>
            <CloseIcon />
          </button>
        </Tooltip>
      )}
    </div>
  );
}
