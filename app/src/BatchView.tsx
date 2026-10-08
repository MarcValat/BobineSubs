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
import { analysisDuration, summarize } from "./AnalysisView";
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
import { loadSetting, saveSetting } from "./settings";
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

/** The folder batch exports go to (null: next to each original), kept for the next session. */
const OUTPUT_DIR_KEY = "syncsubtitles.batchOutputDir";

/** The track of `probe` in `language` to correct: a full one before a forced one. */
function trackInLanguage(probe: ProbeResponse | undefined, language: string | null): number | null {
  const candidates = textTracks(probe ?? null).filter((t) => t.language === language);
  candidates.sort((a, b) => Number(a.forced) - Number(b.forced));
  return candidates[0]?.index ?? null;
}

export default function BatchView({ active }: { active: boolean }) {
  const [kind, setKind] = useState<Kind>("multi");
  // Multi: videos holding both tracks.
  const [multiVideos, setMultiVideos] = useState<string[]>([]);
  const [probes, setProbes] = useState<Record<string, ProbeResponse | string>>({});
  const [language, setLanguage] = useState<string | null>(null);
  // Pairs: videos and subtitle files, paired by episode number.
  const [pairRows, setPairRows] = useState<Row[]>([]);
  // Results by what was analyzed (video + target): kept across re-pairings.
  const [runs, setRuns] = useState<Record<string, RowRuns>>({});
  const [subsOnly, setSubsOnly] = useState(false);
  const [folder, setFolder] = useState<string | null>(() => loadSetting(OUTPUT_DIR_KEY));
  const changeFolder = (dir: string | null) => {
    setFolder(dir);
    saveSetting(OUTPUT_DIR_KEY, dir);
  };
  const [addedLanguage, setAddedLanguage] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState<null | "analysis" | "render">(null);
  const [progress, setProgress] = useState<string | null>(null);
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

  const drag = useFileDrop(active && editingRow === null, busy ? "Attends la fin de la tâche en cours." : null, (files) => {
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

  // What "Exporter tout" does: what's left to do, or once
  // everything is, all of it again.
  const analyzableRows = rows.filter((r) => typeof inputs(r) === "object");
  const analyzedRows = rows.filter((r) => runsOf(r).analysis.status === "done");
  const pendingAnalysis = analyzableRows.filter((r) => runsOf(r).analysis.status !== "done");
  const pendingExport = analyzedRows.filter((r) => runsOf(r).render.status !== "done");
  const exportTodo = pendingExport.length ? pendingExport : analyzedRows;
  const analyzed = analyzedRows.length;
  const exported = rows.filter((r) => runsOf(r).render.status === "done").length;

  // --- view ---------------------------------------------------------------

  const unit = kind === "pairs" ? "paire" : "piste";
  const missing = pendingAnalysis.length;
  const hint =
    kind === "pairs"
      ? "Une ligne = une paire : la vidéo, dont les sous-titres servent de référence, et le fichier de sous-titres à corriger (SRT/ASS). Ils sont appariés par numéro d'épisode (S01E03, 1x03…), sinon dans l'ordre : ↑ ↓ pour corriger l'ordre de la colonne des sous-titres. Un dossier glissé sur la fenêtre ajoute ses fichiers."
      : "Chaque fichier contient déjà la référence et la piste à corriger, choisie par langue pour tous les fichiers. Un dossier glissé sur la fenêtre ajoute ses fichiers.";

  return (
    <main className="batch-main" hidden={!active}>
      <div className="batch-config panel">
        <div className="view-tabs batch-mode" role="tablist">
          <button role="tab" aria-selected={kind === "multi"} className={kind === "multi" ? "active" : ""} onClick={() => setKind("multi")} disabled={busy !== null}>
            Fichiers multipistes
          </button>
          <button role="tab" aria-selected={kind === "pairs"} className={kind === "pairs" ? "active" : ""} onClick={() => setKind("pairs")} disabled={busy !== null}>
            Paires de fichiers
          </button>
        </div>
        {kind === "multi" && (
          <label>
            À corriger :
            <select value={language ?? ""} onChange={(e) => setLanguage(e.target.value)} disabled={busy !== null || !languages.length}>
              {!languages.length && <option value="">—</option>}
              {languages.map(([lang, n]) => (
                <option key={lang} value={lang}>
                  {languageName(lang)} ({lang}) · {n} fichier{n > 1 ? "s" : ""}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Export :
          <select value={subsOnly ? "subs" : "mkv"} onChange={(e) => setSubsOnly(e.target.value === "subs")} disabled={busy !== null}>
            <option value="mkv">Nouveaux MKV</option>
            <option value="subs">Sous-titres seuls</option>
          </select>
        </label>
        {kind === "pairs" && !subsOnly && (
          <>
            <label>
              Langue :
              <select value={addedLanguage} onChange={(e) => setAddedLanguage(e.target.value)} disabled={busy !== null}>
                <option value="">Celle du fichier</option>
                {LANGUAGES.map(([code, name]) => (
                  <option key={code} value={code}>
                    {name} ({code})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Titre :
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="ex. Français" disabled={busy !== null} />
            </label>
          </>
        )}
        <InfoTip>{hint}</InfoTip>
      </div>

      <section className="panel batch-jobs">
        <div className="batch-jobs-header">
          <h2>{kind === "pairs" ? "Paires" : "Fichiers"}</h2>
          <button className="small-button" onClick={clear} disabled={busy !== null || rows.length === 0}>
            Tout retirer
          </button>
        </div>

        {/* Always shown, even empty: its header holds the buttons that add files. */}
        <div className="batch-table-wrap list-scroll">
          <table>
            <colgroup>
              <col className="batch-col-index" />
              <col />
              <col />
              <col className="batch-col-status" />
              <col className="batch-col-status" />
              <col className="batch-col-folder" />
            </colgroup>
            <thead>
              <tr>
                <th className="batch-index">#</th>
                <th>
                  <div className="batch-th-add">
                    <span>{kind === "pairs" ? "Vidéo (référence)" : "Fichier"}</span>
                    <button className="small-button" disabled={busy !== null} onClick={addVideos} title="Ajouter des vidéos">
                      + Ajouter
                    </button>
                  </div>
                </th>
                <th>
                  {kind === "pairs" ? (
                    <div className="batch-th-add">
                      <span>Sous-titres à corriger</span>
                      <button className="small-button" disabled={busy !== null} onClick={addSubtitles} title="Ajouter des sous-titres à corriger (SRT/ASS)">
                        + Ajouter
                      </button>
                    </div>
                  ) : (
                    "Piste à corriger"
                  )}
                </th>
                <th>Analyse</th>
                <th>Export</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="placeholder">
                    {kind === "pairs"
                      ? "Ajoute les vidéos et les sous-titres à corriger, un par épisode."
                      : "Ajoute les fichiers à traiter : chacun contient la référence et la piste à corriger."}
                  </td>
                </tr>
              )}
              {rows.map((row, i) => (
                <BatchRow
                  key={`${row.key}#${i}`}
                  index={i}
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
                  onEdit={() => setEditingRow(row)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="batch-footer panel">
        <div className="batch-output">
          <span className="batch-output-label">Sortie :</span>
          <span className={folder ? "batch-output-dir batch-output-path" : "batch-output-dir"} title={folder ?? undefined}>
            {folder ?? "à côté des originaux"}
          </span>
          <button
            className="small-button"
            disabled={busy !== null}
            title="Dans un autre dossier que l'original, un export garde le nom de l'original (sauf si ce nom y est déjà pris) ; à côté de l'original, il prend le suffixe « .synced »."
            onClick={async () => {
              const dir = await pickFolder("Dossier de sortie");
              if (dir) changeFolder(dir);
            }}
          >
            Choisir un dossier…
          </button>
          {folder && (
            <button className="small-button" disabled={busy !== null} onClick={() => changeFolder(null)} title="Écrire chaque export à côté de son original">
              À côté des originaux
            </button>
          )}
        </div>
        <span className="batch-progress">
          {rows.length} {kind === "pairs" ? `paire${rows.length > 1 ? "s" : ""}` : `fichier${rows.length > 1 ? "s" : ""}`}
          {kind === "pairs"
            ? ` · ${analyzed}/${analyzableRows.length} analysée${analyzed > 1 ? "s" : ""}`
            : ` · ${analyzed}/${analyzableRows.length} piste${analyzableRows.length > 1 ? "s" : ""} analysée${analyzed > 1 ? "s" : ""}`}
          {exported > 0 && ` · ${exported} exporté${kind === "pairs" ? "e" : ""}${exported > 1 ? "s" : ""}`}
          {progress && ` · ${progress}`}
        </span>
        {busy === "analysis" ? (
          <>
            <button className="primary-button" disabled>
              Analyse en cours...
            </button>
            <button className="export-cancel" onClick={cancel}>
              Annuler
            </button>
          </>
        ) : missing === 0 && analyzed > 0 ? (
          <button
            className="primary-button"
            disabled={busy !== null}
            title="Réanalyse tout, y compris ce qui l'est déjà : les modifications faites avec « Modifier » sont perdues."
            onClick={() => analyzeRows(analyzableRows)}
          >
            Tout réanalyser
          </button>
        ) : (
          <>
            {analyzed > 0 && (
              <button
                className="small-button"
                disabled={busy !== null}
                title="Réanalyse tout, y compris ce qui l'est déjà : les modifications faites avec « Modifier » sont perdues."
                onClick={() => analyzeRows(analyzableRows)}
              >
                Tout réanalyser
              </button>
            )}
            <button
              className="primary-button"
              disabled={busy !== null || missing === 0}
              title={analyzed > 0 ? `Analyse seulement les ${unit}s qui ne le sont pas encore ; les autres et leurs modifications sont gardées.` : undefined}
              onClick={() => analyzeRows(pendingAnalysis)}
            >
              {analyzed > 0 ? (missing > 1 ? `Analyser les ${missing} ${unit}s restantes` : `Analyser la ${unit} restante`) : "Analyser tout"}
            </button>
          </>
        )}
        {busy === "render" ? (
          <button className="export-cancel" onClick={cancel}>
            Annuler l'export
          </button>
        ) : (
          <button className="primary-button" onClick={() => exportRows(exportTodo)} disabled={busy !== null || !exportTodo.length}>
            Exporter tout
          </button>
        )}
      </div>

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
        blocked={busy ? "Import impossible pendant une analyse ou un export : attends sa fin." : null}
        label="Déposer pour ajouter au lot"
        hint="Un dossier ajoute ses fichiers, par ordre de nom"
      />
    </main>
  );
}

function multiTargetLabel(p: ProbeResponse | string | undefined, language: string | null): string | null {
  if (typeof p !== "object") return null;
  const index = trackInLanguage(p, language);
  const track = p.tracks.find((t) => t.index === index);
  return track ? `@${track.index} ${track.language ?? "?"} (${track.codec})${track.title ? ` « ${track.title} »` : ""}` : null;
}

/** One row, as Bobine Audio's batch tables: the files (with the buttons
 * that move or drop them), then the analysis with "Modifier", the export,
 * and the written file's folder. */
function BatchRow({
  index,
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
  onEdit,
}: {
  index: number;
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
  onEdit: () => void;
}) {
  const { analysis, render } = runs;
  const result = analysis.result;
  const weak = result
    ? result.segments.some((s) => s.confidence < LOW_CONFIDENCE) ||
      result.warnings.length > 0 ||
      result.target_cues.some((c) => c.corrected === null)
    : false;
  const analysisClass =
    analysis.status === "idle" ? "pending" : analysis.status === "done" ? "done" : analysis.status === "running" ? "running" : analysis.status;
  const renderClass = render.status === "idle" ? "pending" : render.status;

  return (
    <tr className={problem ? "batch-row-flagged" : undefined}>
      <td className="batch-index">{index + 1}</td>
      <td className="batch-file">
        <div className="batch-file-inner">
          <span className="batch-filename" title={row.video ?? ""}>
            {row.video ? fileName(row.video) : "—"}
          </span>
          <span className="batch-file-actions">
            <button className="small-button" onClick={onRemove} disabled={busy} title="Retirer">
              ✕
            </button>
          </span>
        </div>
      </td>
      {kind === "pairs" ? (
        <td className="batch-file">
          <div className="batch-file-inner">
            <span className="batch-filename" title={row.subtitle ?? ""}>
              {row.subtitle ? fileName(row.subtitle) : "—"}
            </span>
            {row.by === "order" && (
              <span className="batch-track-status" title="Aucun numéro d'épisode commun : apparié dans l'ordre">
                ordre
              </span>
            )}
            {row.by === "manual" && <span className="batch-track-status">manuel</span>}
            <span className="batch-file-actions">
              <button className="small-button" onClick={() => onMove(-1)} disabled={busy || !canMoveUp} title="Monter">
                {"↑︎"}
              </button>
              <button className="small-button" onClick={() => onMove(1)} disabled={busy || !canMoveDown} title="Descendre">
                {"↓︎"}
              </button>
            </span>
          </div>
        </td>
      ) : (
        <td className="batch-tracks-cell">{targetLabel ?? <span className="batch-track-status">{problem ?? "Lecture des pistes..."}</span>}</td>
      )}
      <td className={`batch-status batch-status-${problem && analysis.status === "idle" ? "error" : analysisClass}`}>
        {problem && analysis.status === "idle" && problem}
        {!problem && analysis.status === "idle" && "À analyser"}
        {analysis.status === "running" && "Analyse en cours..."}
        {analysis.status === "error" && (analysis.error ?? "Erreur")}
        {analysis.status === "cancelled" && "Annulé"}
        {analysis.status === "done" && result && (
          <div className="batch-target">
            {summarize(result)}
            {result.ratio_name && " · dérive"}
            {runs.edited && " · modifié"}
            {weak && <span className="batch-issues"> ⚠ à vérifier</span>}
            <button className="small-button" disabled={busy} onClick={onEdit}>
              Modifier
            </button>
          </div>
        )}
      </td>
      <td className={`batch-status batch-status-${renderClass}`}>
        {render.status === "idle" && "—"}
        {render.status === "running" && "Export en cours..."}
        {render.status === "done" && render.result && <span title={render.result.path}>{fileName(render.result.path)}</span>}
        {render.status === "error" && (render.error ?? "Erreur")}
        {render.status === "cancelled" && "Annulé"}
      </td>
      <td className="batch-row-actions">
        {render.status === "done" && render.result && (
          <button className="small-button" title="Ouvrir le dossier du fichier écrit" onClick={() => revealItemInDir(render.result!.path)}>
            Dossier
          </button>
        )}
      </td>
    </tr>
  );
}
