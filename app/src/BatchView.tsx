import { useEffect, useMemo, useRef, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  type Analysis,
  cancelJob,
  type FilePair,
  JobCancelled,
  pairFiles,
  planOutputs,
  probe,
  type ProbeResponse,
  type RenderResult,
  runJob,
  startAnalyze,
  startRender,
  type TrackRef,
} from "./api";
import AnalysisView, { analysisDuration, summarize } from "./AnalysisView";
import Dialog from "./Dialog";
import { withSegments } from "./retime";
import SegmentEditor from "./SegmentEditor";
import { DropOverlay, useFileDrop } from "./FileDrop";
import { fileName, isSubtitleFile } from "./format";
import { InfoTip } from "./InfoTip";
import {
  errorMessage,
  IDLE,
  LANGUAGES,
  languageName,
  LOW_CONFIDENCE,
  pickFiles,
  pickFolder,
  type Run,
  SUBTITLE_FILTER,
  textTracks,
  VIDEO_FILTER,
} from "./shared";
import "./BatchView.css";

type Kind = "multi" | "pairs";

/** One episode: what's analyzed and exported. */
interface Row {
  key: string;
  video: string | null;
  /** Pairs: the subtitle file; multi: none (the track is in the video). */
  subtitle: string | null;
  by: FilePair["by"] | "manual";
}

interface RowRuns {
  analysis: Run<Analysis>;
  render: Run<RenderResult>;
  /** The analysis' segments were changed by hand. */
  edited?: boolean;
}

const NO_RUNS: RowRuns = { analysis: IDLE, render: IDLE };

/** The track of `probe` in `language` to correct: a full one before a forced one. */
function trackInLanguage(probe: ProbeResponse | undefined, language: string | null): number | null {
  const candidates = textTracks(probe ?? null).filter((t) => t.language === language);
  candidates.sort((a, b) => Number(a.forced) - Number(b.forced));
  return candidates[0]?.index ?? null;
}

export default function BatchView({ active }: { active: boolean }) {
  const [kind, setKind] = useState<Kind>("pairs");
  // Multi: videos holding both tracks.
  const [multiVideos, setMultiVideos] = useState<string[]>([]);
  const [probes, setProbes] = useState<Record<string, ProbeResponse | string>>({});
  const [language, setLanguage] = useState<string | null>(null);
  // Pairs: videos and subtitle files, paired by episode number.
  const [pairRows, setPairRows] = useState<Row[]>([]);
  // Results by what was analyzed (video + target): kept across re-pairings.
  const [runs, setRuns] = useState<Record<string, RowRuns>>({});
  const [subsOnly, setSubsOnly] = useState(false);
  const [folder, setFolder] = useState<string | null>(null);
  const [addedLanguage, setAddedLanguage] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState<null | "analysis" | "render">(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [details, setDetails] = useState<Row | null>(null);
  const [editingRow, setEditingRow] = useState<Row | null>(null);
  const stop = useRef(false);
  const currentJob = useRef<string | null>(null);

  // --- rows ---------------------------------------------------------------

  const multiRows: Row[] = multiVideos.map((video) => {
    const p = probes[video];
    const index = typeof p === "object" ? trackInLanguage(p, language) : null;
    return { key: `${video}@${index}`, video, subtitle: null, by: null };
  });
  const rows = kind === "multi" ? multiRows : pairRows;

  const languages = useMemo(() => {
    const count = new Map<string, number>();
    for (const p of Object.values(probes)) {
      if (typeof p !== "object") continue;
      for (const lang of new Set(textTracks(p).map((t) => t.language ?? "?"))) count.set(lang, (count.get(lang) ?? 0) + 1);
    }
    return [...count.entries()].sort((a, b) => b[1] - a[1]);
  }, [probes]);

  useEffect(() => {
    if (language === null && languages.length) {
      setLanguage(languages.find(([l]) => l === "fre")?.[0] ?? languages[1]?.[0] ?? languages[0][0]);
    }
  }, [languages, language]);

  /** Why a row can't be analyzed, or its tracks. */
  function inputs(row: Row): { reference: TrackRef; target: TrackRef } | string {
    if (!row.video) return "Pas de vidéo";
    if (kind === "pairs") {
      if (!row.subtitle) return "Pas de sous-titres";
      return { reference: { path: row.video, index: null }, target: { path: row.subtitle, index: null } };
    }
    const p = probes[row.video];
    if (p === undefined) return "Lecture…";
    if (typeof p === "string") return p;
    const index = trackInLanguage(p, language);
    if (index === null) return `Pas de piste ${languageName(language)}`;
    return { reference: { path: row.video, index: null }, target: { path: row.video, index } };
  }

  const runsOf = (row: Row) => runs[row.key] ?? NO_RUNS;
  const updateRuns = (key: string, update: (current: RowRuns) => RowRuns) =>
    setRuns((all) => ({ ...all, [key]: update(all[key] ?? NO_RUNS) }));

  // --- adding files -------------------------------------------------------

  async function addFiles(files: string[]) {
    const videos = files.filter((f) => !isSubtitleFile(f));
    const subtitles = files.filter(isSubtitleFile);
    if (kind === "multi") {
      const fresh = videos.filter((v) => !multiVideos.includes(v));
      setMultiVideos((current) => [...current, ...fresh]);
      for (const video of fresh) {
        probe(video).then(
          (p) => setProbes((all) => ({ ...all, [video]: p.tracks.length ? p : "Aucune piste de sous-titres" })),
          (e) => setProbes((all) => ({ ...all, [video]: errorMessage(e) })),
        );
      }
      return;
    }
    const allVideos = [...new Set([...pairRows.flatMap((r) => (r.video ? [r.video] : [])), ...videos])];
    const allSubtitles = [...new Set([...pairRows.flatMap((r) => (r.subtitle ? [r.subtitle] : [])), ...subtitles])];
    const pairs = await pairFiles(allVideos, allSubtitles);
    setPairRows(pairs.map((p) => ({ key: `${p.video}|${p.subtitle}`, video: p.video, subtitle: p.subtitle, by: p.by })));
  }

  const addVideos = async () => addFiles(await pickFiles("Vidéos", VIDEO_FILTER));
  const addSubtitles = async () => addFiles(await pickFiles("Sous-titres à corriger", SUBTITLE_FILTER));

  function moveSubtitle(i: number, direction: -1 | 1) {
    setPairRows((current) => {
      const next = [...current];
      const j = i + direction;
      if (j < 0 || j >= next.length) return current;
      const a = next[i];
      const b = next[j];
      next[i] = { ...a, subtitle: b.subtitle, by: "manual", key: `${a.video}|${b.subtitle}` };
      next[j] = { ...b, subtitle: a.subtitle, by: "manual", key: `${b.video}|${a.subtitle}` };
      return next;
    });
  }

  function removeRow(row: Row) {
    if (kind === "multi") setMultiVideos((v) => v.filter((x) => x !== row.video));
    else setPairRows((r) => r.filter((x) => x !== row));
  }

  const clear = () => (kind === "multi" ? setMultiVideos([]) : setPairRows([]));

  const drag = useFileDrop(active && details === null, busy ? "Attends la fin de la tâche en cours." : null, (files) => {
    addFiles(files);
  });

  // Dev only: automated UI checks add files without the native dialog.
  useEffect(() => {
    if (!import.meta.env.DEV || !active) return;
    (window as unknown as { __test?: object }).__test = { addFiles, setKind };
  });

  // --- running ------------------------------------------------------------

  async function analyzeRows(todo: Row[]) {
    stop.current = false;
    setBusy("analysis");
    for (const [n, row] of todo.entries()) {
      if (stop.current) break;
      setProgress(`Analyse ${n + 1}/${todo.length} : ${fileName(row.video ?? "")}`);
      const tracks = inputs(row) as { reference: TrackRef; target: TrackRef };
      updateRuns(row.key, () => ({ analysis: { status: "running", log: [] }, render: IDLE }));
      try {
        const result = await runJob<Analysis>(
          startAnalyze(tracks.reference, tracks.target),
          () => {},
          (id) => (currentJob.current = id),
        );
        updateRuns(row.key, (r) => ({ ...r, analysis: { status: "done", log: [], result } }));
      } catch (e) {
        const status = e instanceof JobCancelled ? "cancelled" : "error";
        updateRuns(row.key, (r) => ({ ...r, analysis: { status, log: [], error: errorMessage(e) } }));
      }
    }
    currentJob.current = null;
    setBusy(null);
    setProgress(null);
  }

  async function exportRows(todo: Row[]) {
    stop.current = false;
    setBusy("render");
    let outputs: string[] = [];
    try {
      outputs = await planOutputs(
        todo.map((row) => {
          const a = runsOf(row).analysis.result!;
          return [a.reference, a.target];
        }),
        subsOnly,
        folder,
      );
    } catch (e) {
      for (const row of todo) updateRuns(row.key, (r) => ({ ...r, render: { status: "error", log: [], error: errorMessage(e) } }));
      todo = [];
    }
    for (const [n, row] of todo.entries()) {
      if (stop.current) break;
      setProgress(`Export ${n + 1}/${todo.length} : ${fileName(row.video ?? "")}`);
      const analysis = runsOf(row).analysis.result!;
      const output = outputs[n];
      updateRuns(row.key, (r) => ({ ...r, render: { status: "running", log: [] } }));
      try {
        const result = await runJob<RenderResult>(
          startRender(analysis.reference, analysis.target, analysis.segments, {
            output,
            subs_only: subsOnly,
            language: kind === "pairs" ? addedLanguage || null : null,
            title: kind === "pairs" ? title || null : null,
            default: null,
          }),
          () => {},
          (id) => (currentJob.current = id),
        );
        updateRuns(row.key, (r) => ({ ...r, render: { status: "done", log: [], result } }));
      } catch (e) {
        const status = e instanceof JobCancelled ? "cancelled" : "error";
        updateRuns(row.key, (r) => ({ ...r, render: { status, log: [], error: errorMessage(e) } }));
      }
    }
    currentJob.current = null;
    setBusy(null);
    setProgress(null);
  }

  function cancel() {
    stop.current = true;
    if (currentJob.current) cancelJob(currentJob.current);
  }

  // What "Analyser tout" / "Exporter tout" do: what's left to do, or once
  // everything is, all of it again.
  const analyzableRows = rows.filter((r) => typeof inputs(r) === "object");
  const analyzedRows = rows.filter((r) => runsOf(r).analysis.status === "done");
  const pendingAnalysis = analyzableRows.filter((r) => runsOf(r).analysis.status !== "done");
  const pendingExport = analyzedRows.filter((r) => runsOf(r).render.status !== "done");
  const analysisTodo = pendingAnalysis.length ? pendingAnalysis : analyzableRows;
  const exportTodo = pendingExport.length ? pendingExport : analyzedRows;
  const analyzed = analyzedRows.length;
  const exported = rows.filter((r) => runsOf(r).render.status === "done").length;

  // --- view ---------------------------------------------------------------

  return (
    <div className="view" hidden={!active}>
      <div className="layout">
        <aside className="sidebar">
          <section className="card">
            <h2>
              Série{" "}
              <InfoTip>
                {kind === "pairs"
                  ? "Des vidéos d'un côté, des SRT/ASS de l'autre : appariés par numéro d'épisode (S01E03, 1x03…). Les sous-titres de chaque vidéo servent de référence."
                  : "Des vidéos contenant chacune la référence et la piste à corriger, choisie par langue."}
              </InfoTip>
            </h2>
            <div className="segmented">
              <button className={kind === "pairs" ? "active" : ""} onClick={() => setKind("pairs")} disabled={busy !== null}>
                Vidéos + sous-titres
              </button>
              <button className={kind === "multi" ? "active" : ""} onClick={() => setKind("multi")} disabled={busy !== null}>
                Vidéos multipistes
              </button>
            </div>
            {kind === "pairs" ? (
              <div className="button-row">
                <button onClick={addVideos} disabled={busy !== null}>
                  + Vidéos…
                </button>
                <button onClick={addSubtitles} disabled={busy !== null}>
                  + Sous-titres…
                </button>
              </div>
            ) : (
              <>
                <button onClick={addVideos} disabled={busy !== null}>
                  + Vidéos…
                </button>
                <label className="field">
                  <span>Piste à corriger</span>
                  <select value={language ?? ""} onChange={(e) => setLanguage(e.target.value)} disabled={busy !== null || !languages.length}>
                    {!languages.length && <option value="">—</option>}
                    {languages.map(([lang, n]) => (
                      <option key={lang} value={lang}>
                        {languageName(lang)} ({lang}) · {n} fichier{n > 1 ? "s" : ""}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            <p className="hint">Ou glisse des fichiers, ou des dossiers entiers, sur la fenêtre.</p>
          </section>

          <section className="card">
            <h2>Export</h2>
            <div className="segmented">
              <button className={!subsOnly ? "active" : ""} onClick={() => setSubsOnly(false)} disabled={busy !== null}>
                Nouveaux MKV
              </button>
              <button className={subsOnly ? "active" : ""} onClick={() => setSubsOnly(true)} disabled={busy !== null}>
                Sous-titres seuls
              </button>
            </div>
            <label className="field">
              <span>Dossier de sortie</span>
              <div className="output-row">
                <input readOnly value={folder ?? "À côté de chaque fichier"} />
                <button onClick={async () => setFolder((await pickFolder("Dossier de sortie")) ?? folder)} disabled={busy !== null}>
                  …
                </button>
                {folder && (
                  <button onClick={() => setFolder(null)} disabled={busy !== null} title="À côté de chaque fichier">
                    ✕
                  </button>
                )}
              </div>
            </label>
            {kind === "pairs" && !subsOnly && (
              <>
                <label className="field">
                  <span>Langue de la piste ajoutée</span>
                  <select value={addedLanguage} onChange={(e) => setAddedLanguage(e.target.value)} disabled={busy !== null}>
                    <option value="">Automatique (nom du fichier)</option>
                    {LANGUAGES.map(([code, name]) => (
                      <option key={code} value={code}>
                        {name} ({code})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Titre de la piste</span>
                  <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="ex. Français" disabled={busy !== null} />
                </label>
              </>
            )}
          </section>

          <button className="primary wide big" onClick={() => analyzeRows(analysisTodo)} disabled={busy !== null || !analysisTodo.length}>
            {busy === "analysis"
              ? "Analyse en cours…"
              : pendingAnalysis.length || !analysisTodo.length
                ? `Analyser tout (${analysisTodo.length})`
                : `Tout réanalyser (${analysisTodo.length})`}
          </button>
          <button className="primary wide big" onClick={() => exportRows(exportTodo)} disabled={busy !== null || !exportTodo.length}>
            {busy === "render"
              ? "Export en cours…"
              : pendingExport.length || !exportTodo.length
                ? `Exporter tout (${exportTodo.length})`
                : `Tout réexporter (${exportTodo.length})`}
          </button>
          {busy && (
            <>
              <p className="muted">{progress}</p>
              <button className="wide" onClick={cancel}>
                Annuler
              </button>
            </>
          )}
        </aside>

        <main className="results">
          {rows.length === 0 ? (
            <section className="card fill">
              <h2>Épisodes</h2>
              <div className="placeholder">
                <div className="placeholder-title">Ajoute les épisodes de la série.</div>
                <p>
                  {kind === "pairs"
                    ? "Ajoute ou glisse les vidéos et les sous-titres (ou leurs dossiers) : chaque fichier de sous-titres est associé à son épisode d'après son nom."
                    : "Ajoute ou glisse les vidéos (ou leur dossier), puis choisis la langue de la piste à corriger."}
                </p>
              </div>
            </section>
          ) : (
            <div className="card batch-card">
              <div className="batch-head">
                <h2>
                  {rows.length} épisode{rows.length > 1 ? "s" : ""} · {analyzed} analysé{analyzed > 1 ? "s" : ""} · {exported} exporté
                  {exported > 1 ? "s" : ""}
                </h2>
                <button onClick={clear} disabled={busy !== null}>
                  Tout retirer
                </button>
              </div>
              <table className="batch-table">
                <thead>
                  <tr>
                    <th>Vidéo</th>
                    <th>{kind === "pairs" ? "Sous-titres" : "Piste à corriger"}</th>
                    <th>Résultat</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <BatchRow
                      key={`${row.key}#${i}`}
                      row={row}
                      kind={kind}
                      runs={runsOf(row)}
                      problem={typeof inputs(row) === "string" ? (inputs(row) as string) : null}
                      targetLabel={kind === "multi" ? multiTargetLabel(probes[row.video ?? ""], language) : null}
                      busy={busy !== null}
                      canMoveUp={i > 0}
                      canMoveDown={i < rows.length - 1}
                      onMove={(d) => moveSubtitle(i, d)}
                      onRemove={() => removeRow(row)}
                      onAnalyze={typeof inputs(row) === "object" ? () => analyzeRows([row]) : null}
                      onExport={runsOf(row).analysis.status === "done" ? () => exportRows([row]) : null}
                      onDetails={() => setDetails(row)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </main>
      </div>

      {details && runsOf(details).analysis.result && !editingRow && (
        <Dialog title={fileName(details.video ?? "")} onClose={() => setDetails(null)}>
          <AnalysisView
            analysis={runsOf(details).analysis.result!}
            duration={analysisDuration(runsOf(details).analysis.result!)}
            edited={runsOf(details).edited}
            onEdit={busy ? undefined : () => setEditingRow(details)}
          />
        </Dialog>
      )}
      {editingRow && runsOf(editingRow).analysis.result && (
        <SegmentEditor
          analysis={runsOf(editingRow).analysis.result!}
          duration={analysisDuration(runsOf(editingRow).analysis.result!)}
          onClose={() => setEditingRow(null)}
          onSave={(segments) => {
            const row = editingRow;
            // The export no longer matches: it's to do again.
            updateRuns(row.key, (r) => ({
              analysis: { ...r.analysis, result: withSegments(r.analysis.result!, segments) },
              render: IDLE,
              edited: true,
            }));
            setEditingRow(null);
          }}
        />
      )}
      <DropOverlay
        drag={drag}
        blocked={busy ? "Attends la fin de la tâche en cours." : null}
        label={kind === "pairs" ? "Ajouter des vidéos et des sous-titres" : "Ajouter des vidéos"}
        hint="Fichiers ou dossiers"
      />
    </div>
  );
}

function multiTargetLabel(p: ProbeResponse | string | undefined, language: string | null): string | null {
  if (typeof p !== "object") return null;
  const index = trackInLanguage(p, language);
  const track = p.tracks.find((t) => t.index === index);
  return track ? `#${track.index} · ${track.language} · ${track.codec}${track.title ? ` « ${track.title} »` : ""}` : null;
}

function BatchRow({
  row,
  kind,
  runs,
  problem,
  targetLabel,
  busy,
  canMoveUp,
  canMoveDown,
  onMove,
  onRemove,
  onAnalyze,
  onExport,
  onDetails,
}: {
  row: Row;
  kind: Kind;
  runs: RowRuns;
  problem: string | null;
  targetLabel: string | null;
  busy: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
  onAnalyze: (() => void) | null;
  onExport: (() => void) | null;
  onDetails: () => void;
}) {
  const { analysis, render } = runs;
  const result = analysis.result;
  const weak = result
    ? result.segments.some((s) => s.confidence < LOW_CONFIDENCE) ||
      result.warnings.length > 0 ||
      result.target_cues.some((c) => c.corrected === null)
    : false;

  return (
    <tr className={problem ? "problem" : ""}>
      <td className="file" title={row.video ?? ""}>
        {row.video ? fileName(row.video) : <span className="muted">—</span>}
      </td>
      <td className="file" title={row.subtitle ?? ""}>
        {kind === "pairs" ? (
          <div className="subtitle-cell">
            <span className="subtitle-name">{row.subtitle ? fileName(row.subtitle) : <span className="muted">—</span>}</span>
            {row.by === "order" && <span className="tag" title="Aucun numéro d'épisode commun : apparié par ordre">ordre</span>}
            {row.by === "manual" && <span className="tag">manuel</span>}
            <span className="move">
              <button onClick={() => onMove(-1)} disabled={busy || !canMoveUp} title="Échanger avec la ligne du dessus">
                ↑
              </button>
              <button onClick={() => onMove(1)} disabled={busy || !canMoveDown} title="Échanger avec la ligne du dessous">
                ↓
              </button>
            </span>
          </div>
        ) : (
          (targetLabel ?? <span className="muted">—</span>)
        )}
      </td>
      <td className="status">
        {problem && analysis.status === "idle" ? (
          <span className={problem === "Lecture…" ? "muted" : "warning"}>{problem}</span>
        ) : analysis.status === "idle" ? (
          <span className="muted">À analyser</span>
        ) : analysis.status === "running" ? (
          <span className="muted">Analyse…</span>
        ) : analysis.status === "error" ? (
          <span className="error">{analysis.error}</span>
        ) : analysis.status === "cancelled" ? (
          <span className="muted">Annulé</span>
        ) : (
          <div className="result-cell">
            <button className="link" onClick={onDetails} title="Voir le détail">
              {summarize(result!)}
              {result!.ratio_name && " · dérive"}
              {runs.edited && " · modifié"}
              {weak && <span className="warn-text"> ⚠ à vérifier</span>}
            </button>
            {render.status === "running" && <span className="muted">Export…</span>}
            {render.status === "done" && (
              <span className="success-text" title={render.result!.path}>
                ✓ {fileName(render.result!.path)}{" "}
                <button className="link" onClick={() => revealItemInDir(render.result!.path)}>
                  Afficher
                </button>
              </span>
            )}
            {render.status === "error" && <span className="error">{render.error}</span>}
            {render.status === "cancelled" && <span className="muted">Export annulé</span>}
          </div>
        )}
      </td>
      <td className="actions-cell">
        {onAnalyze && analysis.status !== "idle" && analysis.status !== "running" && (
          <button onClick={onAnalyze} disabled={busy} title="Relancer l'analyse de cet épisode">
            ↻ Analyse
          </button>
        )}
        {onExport && render.status !== "idle" && render.status !== "running" && (
          <button onClick={onExport} disabled={busy} title="Exporter à nouveau cet épisode (remplace le fichier)">
            ↻ Export
          </button>
        )}
        {onExport && render.status === "idle" && (
          <button onClick={onExport} disabled={busy} title="Exporter cet épisode">
            Exporter
          </button>
        )}
        <button onClick={onRemove} disabled={busy} title="Retirer">
          ✕
        </button>
      </td>
    </tr>
  );
}
