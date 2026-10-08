import type { ReactNode } from "react";
import { FilmDropIcon } from "./icons";

/** An empty region's invitation: a dashed zone with the film icon, saying
 * what to drop there; a click does the same as the matching button. */
export function DropZone({ title, children, onClick, disabled = false }: { title: string; children?: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button className="drop-zone-empty" onClick={onClick} disabled={disabled}>
      <FilmDropIcon />
      <span className="drop-zone-empty-title">{title}</span>
      {children && <span className="drop-zone-empty-hint">{children}</span>}
    </button>
  );
}
