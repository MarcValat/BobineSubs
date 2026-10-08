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
import { InfoTip } from "./InfoTip";
import "./SegmentEditor.css";

/** "1:02:03.4", "2:03.4", "123.4" -> seconds; null if unreadable. */
function parseClock(text: string): number | null {
  const parts = text.trim().replace(",", ".").split(":");
  if (parts.length > 3 || parts.some((p) => p === "" || isNaN(Number(p)))) return null;
  return parts.reduce((total, p) => total * 60 + Number(p), 0);
}

/** A number field committed on Enter or when leaving it, not on each key. */
function LazyInput({ value, onCommit, width, title }: { value: string; onCommit: (text: string) => void; width: number; title?: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      className="lazy-input"
      style={{ width }}
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
      } else if (e.key === "Escape") {
        if (confirmClose) setConfirmClose(false);
        else if (dirty) setConfirmClose(true);
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirty, confirmClose, onClose]);

  const unreliable = segments.some((s) => s.confidence < LOW_CONFIDENCE) && segments.length > 1;

  return (
    <div className="dialog-backdrop">
      <div className="dialog editor" role="dialog" aria-label="Modifier les segments">
        <div className="dialog-header">
          <h2>
            Modifier les segments{" "}
            <InfoTip>
              <ul>
                <li>Glisse un segment vers le haut ou le bas pour changer son décalage ; glisse une poignée ● pour déplacer une frontière.</li>
                <li>Double-clique sur le graphe, ou « ✂ Couper ici », pour couper un segment en deux.</li>
                <li>
                  <strong>Aligner</strong> : dans la loupe, clique une réplique de la ligne « Après », puis la réplique de référence qui dit la même
                  chose : tout son segment se décale pour qu'elles commencent ensemble.
                </li>
                <li>« Retirer » supprime un segment (une fausse détection) : son voisin s'étend sur sa durée, avec son propre décalage.</li>
                <li>Décalage : + = les sous-titres à corriger sont en retard sur la référence, − = en avance. Ctrl+Z / Ctrl+Y : défaire / refaire.</li>
              </ul>
            </InfoTip>
          </h2>
          <div className="editor-toolbar">
            <button onClick={() => setHistory(undo)} disabled={!history.past.length} title="Ctrl+Z">
              ↶ Défaire
            </button>
            <button onClick={() => setHistory(redo)} disabled={!history.future.length} title="Ctrl+Y">
              ↷ Refaire
            </button>
            <button onClick={() => apply(analysis.segments)} disabled={!dirty} title="Revenir aux segments de l'analyse">
              Réinitialiser
            </button>
            <button onClick={() => apply(removeUnreliable(segments))} disabled={!unreliable} title="Retire chaque segment peu fiable (⚠) : son voisin s'étend sur sa durée">
              Retirer les segments peu fiables
            </button>
            <span className="spacer" />
            <button onClick={close}>Annuler</button>
            <button className="primary" onClick={() => onSave(history.present)} disabled={!dirty}>
              Enregistrer
            </button>
          </div>
        </div>
        {confirmClose && (
          <div className="confirm-bar">
            <span>Abandonner les modifications ?</span>
            <button onClick={onClose}>Abandonner</button>
            <button className="primary" onClick={() => setConfirmClose(false)}>
              Continuer l'édition
            </button>
          </div>
        )}
        <div className="dialog-body">
          <section className="card">
            <Timeline analysis={shown} duration={duration} editing={editing} />
          </section>
          <section className="card">
            <table className="segments editor-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Début</th>
                  <th>Fin</th>
                  <th>Décalage (ms)</th>
                  <th>Confiance</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {segments.map((s, i) => (
                  <tr key={i} className={s.confidence < LOW_CONFIDENCE ? "weak" : ""}>
                    <td>{i + 1}</td>
                    <td>
                      {i === 0 ? (
                        clock(0)
                      ) : (
                        <LazyInput
                          value={clock(s.start_s, 2)}
                          width={110}
                          onCommit={(text) => {
                            const t = parseClock(text);
                            if (t !== null) apply(moveBoundary(segments, i, t));
                          }}
                        />
                      )}
                    </td>
                    <td>{clock(Math.min(s.end_s, duration), 2)}</td>
                    <td className="offsets">
                      <LazyInput
                        value={ms(s.offset_start)}
                        width={80}
                        title={isDrift(s) ? "Décalage au début du segment" : "Décalage"}
                        onCommit={(text) => {
                          const v = Number(text.replace(",", "."));
                          if (isNaN(v)) return;
                          const value = v / 1000;
                          apply(isDrift(s) ? setOffsets(segments, i, value, s.offset_end) : setOffsets(segments, i, value, value));
                        }}
                      />
                      {isDrift(s) && (
                        <>
                          <span className="muted"> → </span>
                          <LazyInput
                            value={ms(s.offset_end)}
                            width={80}
                            title="Décalage à la fin du segment"
                            onCommit={(text) => {
                              const v = Number(text.replace(",", "."));
                              if (!isNaN(v)) apply(setOffsets(segments, i, s.offset_start, v / 1000));
                            }}
                          />
                        </>
                      )}
                    </td>
                    <td className="num">
                      {Math.round(s.confidence * 100)} %{s.confidence < LOW_CONFIDENCE && " ⚠"}
                    </td>
                    <td className="row-actions">
                      <button
                        onClick={() => apply(remove(segments, i))}
                        disabled={segments.length < 2}
                        title={segments.length < 2 ? "Le seul segment ne peut pas être retiré." : "Retirer ce segment : son voisin s'étend sur sa durée"}
                      >
                        Retirer
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      </div>
    </div>
  );
}
