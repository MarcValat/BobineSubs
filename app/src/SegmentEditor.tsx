import { useCallback, useEffect, useMemo, useState } from "react";
import type { Analysis, Segment } from "./api";
import {
  align,
  commit,
  type History,
  isDrift,
  moveBoundary,
  redo,
  remove,
  removeUnreliable,
  setOffsets,
  shiftOffset,
  split,
  startHistory,
  undo,
} from "./editing";
import { clock } from "./format";
import { withSegments } from "./retime";
import { LOW_CONFIDENCE } from "./shared";
import Timeline, { type TimelineEditing } from "./Timeline";
import { Dialog, DialogHeader } from "./Dialog";
import { InfoTip } from "./InfoTip";
import "./SegmentEditor.css";

/** "1:02:03.4", "2:03.4", "123.4" -> seconds; null if unreadable. */
function parseClock(text: string): number | null {
  const parts = text.trim().replace(",", ".").split(":");
  if (parts.length > 3 || parts.some((p) => p === "" || isNaN(Number(p)))) return null;
  return parts.reduce((total, p) => total * 60 + Number(p), 0);
}

/** A number field committed on Enter or when leaving it, not on each key. */
function LazyInput({ value, onCommit, title }: { value: string; onCommit: (text: string) => void; title?: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      inputMode="decimal"
      value={text}
      title={title}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== value && onCommit(text)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setText(value);
          e.stopPropagation();
        }
      }}
    />
  );
}

const ms = (seconds: number) => String(Math.round(seconds * 1000));

/** Hand-correct an analysis' segments, previewed live; `onSave` gets the
 * new list (exported as is, never re-detected). */
export default function SegmentEditor({
  analysis,
  duration,
  onSave,
  onClose,
}: {
  analysis: Analysis;
  duration: number;
  onSave: (segments: Segment[]) => void;
  onClose: () => void;
}) {
  const [history, setHistory] = useState<History>(() => startHistory(analysis.segments));
  // What a drag in progress shows, before it's committed.
  const [live, setLive] = useState<Segment[] | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const segments = live ?? history.present;
  const shown = useMemo(() => withSegments(analysis, segments), [analysis, segments]);
  const dirty = history.present !== analysis.segments;

  const apply = useCallback((next: Segment[]) => setHistory((h) => commit(h, next)), []);

  const editing: TimelineEditing = {
    onDragBoundary: (i, t, done) => {
      const next = moveBoundary(history.present, i, t);
      if (done) {
        setLive(null);
        apply(next);
      } else setLive(next);
    },
    onDragSegment: (i, delta, done) => {
      const next = shiftOffset(history.present, i, delta);
      if (done) {
        setLive(null);
        if (Math.abs(delta) > 0.001) apply(next);
      } else setLive(next);
    },
    onSplit: (t) => apply(split(history.present, t)),
    onAlign: (i, from, to) => apply(align(history.present, i, from, to)),
  };

  const close = () => (dirty ? setConfirmClose(true) : onClose());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && key === "z" && !e.shiftKey) {
        e.preventDefault();
        setHistory(undo);
      } else if ((e.ctrlKey || e.metaKey) && (key === "y" || (key === "z" && e.shiftKey))) {
        e.preventDefault();
        setHistory(redo);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const unreliable = segments.some((s) => s.confidence < LOW_CONFIDENCE) && segments.length > 1;

  return (
    <Dialog
      fill
      onClose={onClose}
      // Escape backs out of the "abandon changes?" question first.
      onEscape={() => (confirmClose ? setConfirmClose(false) : close())}
      className="editor-panel"
    >
      <DialogHeader
        title={
          <>
            Corriger manuellement les segments{" "}
            <InfoTip>
              <ul>
                <li>Glisse un segment vers le haut ou le bas pour changer son décalage.</li>
                <li>Glisse une poignée ● pour déplacer une frontière.</li>
                <li>Double-clique sur le graphe, ou « ✂ Couper ici », pour couper un segment à cet endroit.</li>
                <li>
                  Aligner : dans la loupe, clique une réplique de la ligne « Après », puis la réplique de référence qui dit la même chose : tout son
                  segment se décale pour qu'elles commencent ensemble.
                </li>
                <li>Un segment marqué ⚠ est peu fiable : à vérifier.</li>
                <li>« Retirer » supprime un segment (une fausse détection, par exemple) : son voisin s'étend sur sa durée, avec son propre décalage.</li>
                <li>Ctrl+Z / Ctrl+Y : défaire / refaire.</li>
                <li>Décalage : + = les sous-titres à corriger sont en retard sur la référence, − = en avance.</li>
              </ul>
            </InfoTip>
          </>
        }
      >
        {confirmClose ? (
          <div className="editor-confirm-close" role="alertdialog">
            <span>Abandonner les modifications non enregistrées ?</span>
            <button className="small-button export-cancel" onClick={onClose}>
              Abandonner
            </button>
            <button className="small-button" onClick={() => setConfirmClose(false)}>
              Continuer l'édition
            </button>
          </div>
        ) : (
          <button className="small-button" onClick={close} title="Fermer sans enregistrer (Échap)">
            Annuler
          </button>
        )}
      </DialogHeader>

      <div className="editor-columns">
        <div className="editor-primary">
          <div className="editor-timeline">
            <Timeline analysis={shown} duration={duration} editing={editing} />
          </div>
          <div className="editor-table-wrap list-scroll">
            <table className="editor-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Début</th>
                  <th>Fin</th>
                  <th title="Décalage au début du segment, en millisecondes">
                    Décal. début <span className="th-unit">(ms)</span>
                  </th>
                  <th title="Décalage à la fin du segment, en millisecondes">
                    Décal. fin <span className="th-unit">(ms)</span>
                  </th>
                  <th>Confiance</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {segments.map((s, i) => (
                  <tr key={i} className={s.confidence < LOW_CONFIDENCE ? "editor-row-low-confidence" : undefined}>
                    <td>{i + 1}</td>
                    <td>
                      {i === 0 ? (
                        clock(0, 2)
                      ) : (
                        <LazyInput
                          value={clock(s.start_s, 2)}
                          onCommit={(text) => {
                            const t = parseClock(text);
                            if (t !== null) apply(moveBoundary(segments, i, t));
                          }}
                        />
                      )}
                    </td>
                    <td>{clock(Math.min(s.end_s, duration), 2)}</td>
                    <td>
                      <LazyInput
                        value={ms(s.offset_start)}
                        onCommit={(text) => {
                          const v = Number(text.replace(",", "."));
                          if (isNaN(v)) return;
                          const value = v / 1000;
                          apply(isDrift(s) ? setOffsets(segments, i, value, s.offset_end) : setOffsets(segments, i, value, value));
                        }}
                      />
                    </td>
                    <td>
                      <LazyInput
                        value={ms(s.offset_end)}
                        onCommit={(text) => {
                          const v = Number(text.replace(",", "."));
                          if (!isNaN(v)) apply(setOffsets(segments, i, s.offset_start, v / 1000));
                        }}
                      />
                    </td>
                    <td className={s.confidence < LOW_CONFIDENCE ? "editor-confidence-cell low" : "editor-confidence-cell"}>
                      {s.confidence < LOW_CONFIDENCE ? "⚠ " : ""}
                      {Math.round(s.confidence * 100)}%
                    </td>
                    <td>
                      <button
                        className="small-button"
                        onClick={() => apply(remove(segments, i))}
                        disabled={segments.length < 2}
                        title={
                          segments.length < 2
                            ? "Le seul segment ne peut pas être retiré."
                            : `Retire le segment ${i + 1} (une fausse détection, par exemple) : le segment ${i < segments.length - 1 ? i + 2 : i} s'étend sur sa durée, avec son propre décalage.`
                        }
                      >
                        Retirer
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="editor-actions">
        <div className="editor-history">
          <button className="small-button" onClick={() => setHistory(undo)} disabled={!history.past.length} title="Ctrl+Z">
            ↶ Défaire
          </button>
          <button className="small-button" onClick={() => setHistory(redo)} disabled={!history.future.length} title="Ctrl+Y">
            ↷ Refaire
          </button>
          <button className="small-button" onClick={() => apply(analysis.segments)} disabled={!dirty} title="Revient aux segments tels qu'à l'ouverture de l'éditeur.">
            Réinitialiser
          </button>
        </div>
        <button
          className="small-button"
          onClick={() => apply(removeUnreliable(segments))}
          disabled={!unreliable}
          title="Retire chaque segment peu fiable (⚠), comme « Retirer » sur chacun : son voisin s'étend sur sa durée."
        >
          Retirer les segments peu fiables
        </button>
        <button className="primary-button" onClick={() => onSave(history.present)}>
          Enregistrer
        </button>
      </div>
    </Dialog>
  );
}
