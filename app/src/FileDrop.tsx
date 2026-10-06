import { useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview, type DragDropEvent } from "@tauri-apps/api/webview";
import { expandPaths } from "./api";
import { SUBTITLE_EXTENSIONS, VIDEO_EXTENSIONS } from "./format";
import "./FileDrop.css";

/** Which half of the window files are dragged over (pairs mode drops the
 * reference files on the left, the ones to correct on the right). */
export type DropSide = "left" | "right";

/** Files being dragged over the window, and where. */
export interface FileDrag {
  side: DropSide;
}

/** Files dragged from the explorer onto the window, while `enabled` (the
 * view is on screen and no dialog covers it): `onDrop` gets the dropped
 * files, a folder standing for its media files in name order (see the
 * engine's /paths/expand). While `blocked`, the overlay says why and a drop
 * does nothing. Returns the drag in progress, for DropOverlay. */
export function useFileDrop(
  enabled: boolean,
  blocked: string | null,
  onDrop: (files: string[], side: DropSide) => void,
): FileDrag | null {
  const [drag, setDrag] = useState<FileDrag | null>(null);
  // The latest of each, without resubscribing on every render.
  const latest = useRef({ blocked, onDrop });
  latest.current = { blocked, onDrop };

  useEffect(() => {
    if (!enabled) return;
    const sideAt = (x: number): DropSide => (x / window.devicePixelRatio < window.innerWidth / 2 ? "left" : "right");
    function handle(event: DragDropEvent) {
      if (event.type === "leave") {
        setDrag(null);
      } else if (event.type === "enter" || event.type === "over") {
        setDrag({ side: sideAt(event.position.x) });
      } else {
        setDrag(null);
        if (latest.current.blocked) return;
        const side = sideAt(event.position.x);
        expandPaths(event.paths, [...VIDEO_EXTENSIONS, ...SUBTITLE_EXTENSIONS])
          .then((files) => {
            if (files.length > 0) latest.current.onDrop(files, side);
          })
          .catch(() => {
            // the engine is down: nothing could be done with them anyway
          });
      }
    }

    // Dev only, in a plain browser: automated checks dispatch a
    // `syncsubtitles:dragdrop` event carrying what Tauri would send.
    if (import.meta.env.DEV && !isTauri()) {
      const listener = (e: Event) => handle((e as CustomEvent<DragDropEvent>).detail);
      window.addEventListener("syncsubtitles:dragdrop", listener);
      return () => {
        window.removeEventListener("syncsubtitles:dragdrop", listener);
        setDrag(null);
      };
    }

    let unlisten: (() => void) | null = null;
    let gone = false;
    getCurrentWebview()
      .onDragDropEvent((e) => handle(e.payload))
      .then((u) => {
        if (gone) u();
        else unlisten = u;
      });
    return () => {
      gone = true;
      unlisten?.();
      setDrag(null);
    };
  }, [enabled]);

  return drag;
}

/** What dropping would do, over the whole window: one `label`, or two
 * halves (`split`, left then right) with the one under the pointer lit. */
export function DropOverlay({
  drag,
  blocked,
  label,
  hint,
  split,
}: {
  drag: FileDrag | null;
  blocked: string | null;
  label?: string;
  hint?: string;
  split?: [string, string];
}) {
  if (!drag) return null;
  if (blocked) {
    return (
      <div className="drop-overlay">
        <div className="drop-zone drop-zone-blocked">
          <span className="drop-label">{blocked}</span>
        </div>
      </div>
    );
  }
  if (split) {
    return (
      <div className="drop-overlay drop-overlay-split">
        {split.map((text, i) => (
          <div key={text} className={`drop-zone ${drag.side === (i === 0 ? "left" : "right") ? "drop-zone-active" : ""}`}>
            <span className="drop-label">{text}</span>
            {hint && <span className="drop-hint">{hint}</span>}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="drop-overlay">
      <div className="drop-zone drop-zone-active">
        <span className="drop-label">{label}</span>
        {hint && <span className="drop-hint">{hint}</span>}
      </div>
    </div>
  );
}
