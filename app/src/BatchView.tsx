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
import { DropOverlay, type DropSide, useFileDrop } from "./FileDrop";
import { DropZone } from "./DropZone";
import { fileName, isSubtitleFile, SUBTITLE_EXTENSIONS, VIDEO_EXTENSIONS } from "./format";
import { Dialog, DialogHeader } from "./Dialog";
import { FolderIcon, RedoIcon } from "./icons";
import { InfoTip } from "./InfoTip";
import { PillSwitch } from "./PillSwitch";
import {
  errorMessage,
  IDLE,
  LANGUAGES,
  languageName,
  LOW_CONFIDENCE,
  pickFiles,
  pickFolder,
  type Run,
  textTracks,
  VIDEO_FILTER,
} from "./shared";
import { loadSetting, saveSetting } from "./settings";
import "./BatchView.css";

/** Fichiers multipistes / Paires de fichiers: picked in the top bar (App.tsx). */
export type Kind = "multi" | "pairs";

/** One episode: what's analyzed and exported. */
interface Row {
  key: string;
  video: string | null;
  /** Pairs: the file to correct, a subtitle file or a video holding the
   * track (picked by language); multi: none (the track is in the video). */
  target: string | null;
  by: FilePair["by"] | "manual";
}

interface RowRuns {
  analysis: Run<Analysis>;
  render: Run<RenderResult>;
  /** The analysis' segments were changed by hand. */
  edited?: boolean;
  /** Waiting for its turn in the analysis running ("En attente"). */
  queued?: boolean;
}

const NO_RUNS: RowRuns = { analysis: IDLE, render: IDLE };

/** The folder batch exports go to (null: next to each original), kept for the next session. */
const OUTPUT_DIR_KEY = "syncsubtitles.batchOutputDir";

/** The track of `probe` in `language` to correct: a full one before a
 * forced one; never `exclude` (the reference). */
function trackInLanguage(probe: ProbeResponse | undefined, language: string | null, exclude: number | null = null): number | null {
  const candidates = textTracks(probe ?? null).filter((t) => t.language === language && t.index !== exclude);
  candidates.sort((a, b) => Number(a.forced) - Number(b.forced));
  return candidates[0]?.index ?? null;
}

/** The reference track of `probe` in `language`: a full one before a forced
 * one, text before image (both can be a reference). */
function referenceInLanguage(probe: ProbeResponse, language: string): number | null {
  const candidates = probe.tracks.filter((t) => t.format !== null && t.language === language);
  candidates.sort((a, b) => Number(a.forced) - Number(b.forced) || Number(isImage(a.format)) - Number(isImage(b.format)));
  return candidates[0]?.index ?? null;
}

const isImage = (format: string | null) => format === "pgs" || format === "vobsub";

export default function BatchView({
  active,
  kind,
  onKindChange,
  onBusyChange,
}: {
  active: boolean;
  kind: Kind;
  onKindChange: (kind: Kind) => void;
  /** Analyzing or exporting: the top bar keeps the sub-mode meanwhile. */
  onBusyChange: (busy: boolean) => void;
}) {
  // Multi: videos holding both tracks.
  const [multiVideos, setMultiVideos] = useState<string[]>([]);
  const [probes, setProbes] = useState<Record<string, ProbeResponse | string>>({});
  const [language, setLanguage] = useState<string | null>(null);
  // Pairs: the language of the track to correct in the videos to correct.
  const [targetLanguage, setTargetLanguage] = useState<string | null>(null);
  // Both: the reference track's language; null: chosen by the engine (the most complete).
  const [referenceLanguage, setReferenceLanguage] = useState<string | null>(null);
  // Tracks picked by hand ("Choisir"), by row (choiceKey): over the
  // languages' rule for that row only.
  const [choices, setChoices] = useState<Record<string, TrackChoice>>({});
  const [choosing, setChoosing] = useState<Row | null>(null);
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
  useEffect(() => onBusyChange(busy !== null), [busy, onBusyChange]);
  const currentJob = useRef<string | null>(null);

  // --- rows ---------------------------------------------------------------

  // The tracks used are part of a row's key: other tracks, another analysis.
  const withKey = (row: Row): Row => {
    const tracks = resolve(row.video, row.target);
    const used = typeof tracks === "string" ? "!" : `@${tracks.reference.index}>${tracks.target.path}#${tracks.target.index}`;
    return { ...row, key: `${row.key}${used}` };
  };
  const multiRows: Row[] = multiVideos.map((video) => withKey({ key: video, video, target: null, by: null }));
  const pairTargetVideos = pairRows.flatMap((r) => (r.target && !isSubtitleFile(r.target) ? [r.target] : []));
  const pairReferences = pairRows.flatMap((r) => (r.video ? [r.video] : []));
  const rows = kind === "multi" ? multiRows : pairRows.map(withKey);

  /** The reference track of `video`: null when the engine picks it (no
   * language chosen), or why there's none. */
  function referenceOf(video: string): number | null | string {
    if (referenceLanguage === null) return null;
    const p = probes[video];
    if (p === undefined) return "Lecture…";
    if (typeof p === "string") return p;
    return referenceInLanguage(p, referenceLanguage) ?? `Pas de référence ${languageName(referenceLanguage)}`;
  }

  const languages = useLanguages(multiVideos, probes);
  const targetLanguages = useLanguages(pairTargetVideos, probes);
  const referenceLanguages = useLanguages(kind === "multi" ? multiVideos : pairReferences, probes, true);

  useEffect(() => {
    if (language === null && languages.length) setLanguage(defaultLanguage(languages));
  }, [languages, language]);
  useEffect(() => {
    if (targetLanguage === null && targetLanguages.length) setTargetLanguage(defaultLanguage(targetLanguages));
  }, [targetLanguages, targetLanguage]);

  /** Why a row can't be analyzed, or its tracks. */
  const inputs = (row: Row) => resolve(row.video, row.target);

  /** A row's tracks -- picked by hand ("Choisir"), else by the languages --
   * or why there are none. Pairs: `target` is the file to correct; multi:
   * null (the track is in `video`). */
  function resolve(video: string | null, target: string | null): { reference: TrackRef; target: TrackRef } | string {
    if (!video) return "Pas de vidéo";
    const manual = choices[choiceKey(video, target)];
    const index = manual ? manual.reference : referenceOf(video);
    if (typeof index === "string") return index;
    const reference = { path: video, index };
    if (kind === "pairs") {
      if (!target) return "Rien à corriger";
      if (isSubtitleFile(target)) return { reference, target: { path: target, index: null } };
      const track = manual?.target ?? trackIn(target, targetLanguage);
      return typeof track === "string" ? track : { reference, target: { path: target, index: track } };
    }
    const track = manual?.target ?? trackIn(video, language, index);
    return typeof track === "string" ? track : { reference, target: { path: video, index: track } };
  }

  /** The track to correct in a probed video (never `exclude`, the
   * reference), or why there's none. */
  function trackIn(path: string, lang: string | null, exclude: number | null = null): number | string {
    const p = probes[path];
    if (p === undefined) return "Lecture…";
    if (typeof p === "string") return p;
    return trackInLanguage(p, lang, exclude) ?? `Pas de piste ${languageName(lang)}`;
  }

  const runsOf = (row: Row) => runs[row.key] ?? NO_RUNS;
  const updateRuns = (key: string, update: (current: RowRuns) => RowRuns) =>
    setRuns((all) => ({ ...all, [key]: update(all[key] ?? NO_RUNS) }));

  // --- adding files -------------------------------------------------------

  /** Reads a video's tracks once (the track to correct is picked from them). */
  function probeVideos(videos: string[]) {
    for (const video of videos) {
      if (probes[video] !== undefined) continue;
      probe(video).then(
        (p) => setProbes((all) => ({ ...all, [video]: p.tracks.length ? p : "Aucune piste de sous-titres" })),
        (e) => setProbes((all) => ({ ...all, [video]: errorMessage(e) })),
      );
    }
  }

  /** Pairs: `side` is the column ("left": the references, "right": the
   * files to correct); a subtitle file can only be corrected, wherever
   * it's dropped. Multi: videos only. */
  async function addFiles(files: string[], side: DropSide = "right") {
    if (kind === "multi") {
      const fresh = files.filter((f) => !isSubtitleFile(f) && !multiVideos.includes(f));
      setMultiVideos((current) => [...current, ...fresh]);
      probeVideos(fresh);
      return;
    }
    const references = side === "left" ? files.filter((f) => !isSubtitleFile(f)) : [];
    const targets = side === "left" ? files.filter(isSubtitleFile) : files;
    probeVideos([...references, ...targets.filter((f) => !isSubtitleFile(f))]);
    const allReferences = [...new Set([...pairRows.flatMap((r) => (r.video ? [r.video] : [])), ...references])];
    const allTargets = [...new Set([...pairRows.flatMap((r) => (r.target ? [r.target] : [])), ...targets])];
    const pairs = await pairFiles(allReferences, allTargets);
    setPairRows(pairs.map((p) => ({ key: `${p.video}|${p.subtitle}`, video: p.video, target: p.subtitle, by: p.by })));
  }

  const addVideos = async () => addFiles(await pickFiles("Vidéos de référence", VIDEO_FILTER), "left");
  const addTargets = async () => addFiles(await pickFiles("À corriger : sous-titres ou vidéos", TARGET_FILTER), "right");
  const addMultiVideos = async () => addFiles(await pickFiles("Vidéos", VIDEO_FILTER));

  function moveSubtitle(i: number, direction: -1 | 1) {
    setPairRows((current) => {
      const next = [...current];
      const j = i + direction;
      if (j < 0 || j >= next.length) return current;
      const a = next[i];
      const b = next[j];
      next[i] = { ...a, target: b.target, by: "manual", key: `${a.video}|${b.target}` };
      next[j] = { ...b, target: a.target, by: "manual", key: `${b.video}|${a.target}` };
      return next;
    });
  }

  /** Multi: the file. Pairs: one side's file only (`side`), the row going
   * once neither is left. */
  function removeRow(row: Row, side: "video" | "target" = "video") {
    if (kind === "multi") {
      setMultiVideos((v) => v.filter((x) => x !== row.video));
      return;
    }
    setPairRows((rows) =>
      rows.flatMap((x) => {
        if (x.video !== row.video || x.target !== row.target) return [x];
        const left = side === "video" ? { ...x, video: null } : { ...x, target: null };
        return left.video || left.target ? [{ ...left, by: null, key: `${left.video}|${left.target}` }] : [];
      }),
    );
  }

  const clear = () => (kind === "multi" ? setMultiVideos([]) : setPairRows([]));

  const drag = useFileDrop(active && editingRow === null, busy ? "Attends la fin de la tâche en cours." : null, (files, side) => {
    addFiles(files, side);
  });

  // Dev only: automated UI checks add files without the native dialog.
  useEffect(() => {
    if (!import.meta.env.DEV || !active) return;
    (window as unknown as { __test?: object }).__test = { addFiles, setKind: onKindChange };
  });

  // --- running ------------------------------------------------------------

  async function analyzeRows(todo: Row[]) {
    stop.current = false;
    setBusy("analysis");
    // Every row to analyze loses its result at once ("En attente"): the
    // rows already done can be edited meanwhile, never one about to be
    // analyzed again (its edits would be overwritten).
    for (const row of todo) updateRuns(row.key, () => ({ analysis: IDLE, render: IDLE, queued: true }));
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
    // Cancelled: the rows not reached are back to "À analyser".
    for (const row of todo) updateRuns(row.key, (r) => (r.queued ? { ...r, queued: false } : r));
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
      ? "Une ligne = une paire : la vidéo, dont les sous-titres servent de référence, et ce qu'il faut corriger : un fichier de sous-titres (SRT/ASS), ou une vidéo qui contient la piste à corriger, choisie par langue pour toutes. Ils sont appariés par numéro d'épisode (S01E03, 1x03…), sinon dans l'ordre : ↑ ↓ pour corriger l'ordre de la colonne « À corriger ». Glissés sur la moitié gauche de la fenêtre, des fichiers vont en référence ; sur la droite, à corriger."
      : "Chaque fichier contient déjà la référence et la piste à corriger, choisie par langue pour tous les fichiers. Un dossier glissé sur la fenêtre ajoute ses fichiers.";

  return (
    <main className="batch-main" hidden={!active}>
      <div className="batch-config panel">
        <label>
          Référence :
          <select
            value={referenceLanguage ?? ""}
            onChange={(e) => setReferenceLanguage(e.target.value || null)}
            disabled={busy !== null}
            title="La piste de sous-titres déjà bien calée de chaque vidéo : par défaut la plus complète, ou celle d'une langue (complète plutôt que forcée)."
          >
            <option value="">Automatique (la plus complète)</option>
            {referenceLanguages.map(([lang, n]) => (
              <option key={lang} value={lang}>
                {languageName(lang)} ({lang}) · {n} fichier{n > 1 ? "s" : ""}
              </option>
            ))}
          </select>
        </label>
        {kind === "multi" && <LanguageSelect value={language} languages={languages} onChange={setLanguage} disabled={busy !== null} />}
        {kind === "pairs" && pairTargetVideos.length > 0 && (
          <LanguageSelect value={targetLanguage} languages={targetLanguages} onChange={setTargetLanguage} disabled={busy !== null} />
        )}
        <span className="batch-config-field">
          Export :
          <PillSwitch
            label="Contenu de l'export"
            options={[
              ["mkv", "Nouveaux MKV"],
              ["subs", "Sous-titres seuls"],
            ]}
            value={subsOnly ? "subs" : "mkv"}
            onChange={(v) => setSubsOnly(v === "subs")}
            disabled={busy !== null}
          />
        </span>
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
                    <button className="small-button" disabled={busy !== null} onClick={kind === "pairs" ? addVideos : addMultiVideos} title="Ajouter des vidéos">
                      + Ajouter
                    </button>
                  </div>
                </th>
                <th>
                  {kind === "pairs" ? (
                    <div className="batch-th-add">
                      <span>À corriger</span>
                      <button
                        className="small-button"
                        disabled={busy !== null}
                        onClick={addTargets}
                        title="Ajouter ce qu'il faut corriger : des sous-titres (SRT/ASS), ou des vidéos qui contiennent la piste à corriger"
                      >
                        + Ajouter
                      </button>
                    </div>
                  ) : (
                    "Pistes"
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
                  <td colSpan={6} className="batch-empty">
                    <DropZone title="Glisse des fichiers ou des dossiers ici" onClick={kind === "pairs" ? addVideos : addMultiVideos} disabled={busy !== null}>
                      {kind === "pairs"
                        ? "À gauche de la fenêtre, les vidéos de référence ; à droite, ce qu'il faut corriger (sous-titres ou vidéos), un par épisode : ils sont appariés d'après leur nom."
                        : "Des vidéos qui contiennent chacune la référence et la piste à corriger."}
                    </DropZone>
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
                  targetLabel={tracksLabel(row, inputs(row), probes, kind)}
                  manual={choices[choiceKey(row.video, row.target)] !== undefined}
                  onChoose={row.video && typeof probes[row.video] === "object" ? () => setChoosing(row) : null}
                  onByLanguage={() =>
                    setChoices((all) => {
                      const next = { ...all };
                      delete next[choiceKey(row.video, row.target)];
                      return next;
                    })
                  }
                  busy={busy !== null}
                  exporting={busy === "render"}
                  canMoveUp={i > 0}
                  canMoveDown={i < rows.length - 1}
                  onMove={(d) => moveSubtitle(i, d)}
                  onRemove={(side) => removeRow(row, side)}
                  onEdit={() => setEditingRow(row)}
                  onReanalyze={typeof inputs(row) === "object" ? () => analyzeRows([row]) : null}
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

      {choosing && choosing.video && typeof probes[choosing.video] === "object" && (
        <ChooseTracksDialog
          reference={probes[choosing.video] as ProbeResponse}
          target={
            kind === "multi"
              ? (probes[choosing.video] as ProbeResponse)
              : choosing.target && !isSubtitleFile(choosing.target) && typeof probes[choosing.target] === "object"
                ? (probes[choosing.target] as ProbeResponse)
                : null
          }
          current={(() => {
            const tracks = inputs(choosing);
            return typeof tracks === "string" ? null : { reference: tracks.reference.index, target: tracks.target.index };
          })()}
          onClose={() => setChoosing(null)}
          onSave={(choice) => {
            setChoices((all) => ({ ...all, [choiceKey(choosing.video, choosing.target)]: choice }));
            setChoosing(null);
          }}
        />
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
        blocked={busy ? "Import impossible pendant une analyse ou un export : attends sa fin." : null}
        label="Déposer pour ajouter au lot"
        split={kind === "pairs" ? ["Vidéos de référence", "À corriger : sous-titres ou vidéos"] : undefined}
        hint="Un dossier ajoute ses fichiers, par ordre de nom"
      />
    </main>
  );
}

/** Pairs: what the "À corriger" column takes. */
const TARGET_FILTER = { name: "Sous-titres ou vidéos", extensions: [...SUBTITLE_EXTENSIONS, ...VIDEO_EXTENSIONS] };

/** The languages of the text tracks in `videos` (with `images`, of every
 * usable track: a reference may be PGS/VobSub), most common first. */
function useLanguages(videos: string[], probes: Record<string, ProbeResponse | string>, images = false): [string, number][] {
  return useMemo(() => {
    const count = new Map<string, number>();
    for (const video of new Set(videos)) {
      const p = probes[video];
      if (typeof p !== "object") continue;
      const tracks = images ? p.tracks.filter((t) => t.format !== null) : textTracks(p);
      for (const lang of new Set(tracks.map((t) => t.language ?? "?"))) count.set(lang, (count.get(lang) ?? 0) + 1);
    }
    return [...count.entries()].sort((a, b) => b[1] - a[1]);
  }, [videos, probes, images]);
}

/** French when there is, else the second most common (the first being the
 * reference's, likely). */
function defaultLanguage(languages: [string, number][]): string {
  return languages.find(([l]) => l === "fre")?.[0] ?? languages[1]?.[0] ?? languages[0][0];
}

/** "À corriger : <language>", the track to correct in every video. */
function LanguageSelect({
  value,
  languages,
  onChange,
  disabled,
}: {
  value: string | null;
  languages: [string, number][];
  onChange: (language: string) => void;
  disabled: boolean;
}) {
  return (
    <label>
      À corriger :
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value)} disabled={disabled || !languages.length}>
        {!languages.length && <option value="">—</option>}
        {languages.map(([lang, n]) => (
          <option key={lang} value={lang}>
            {languageName(lang)} ({lang}) · {n} fichier{n > 1 ? "s" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Tracks picked by hand for a row: the reference's index, and the track
 * to correct's (null: the file to correct is a subtitle file). */
interface TrackChoice {
  reference: number;
  target: number | null;
}

/** Where a row's hand-picked tracks are kept: its files. */
const choiceKey = (video: string | null, target: string | null) => `${video}|${target ?? ""}`;

/** "@0 eng → @2 fre (subrip) « Titre »", the reference "Réf. auto" when the
 * engine picks it (as Bobine Audio's "Pistes" column); pairs: the target
 * track only for a video to correct, nothing for a subtitle file. */
function tracksLabel(
  row: Row,
  tracks: { reference: TrackRef; target: TrackRef } | string,
  probes: Record<string, ProbeResponse | string>,
  kind: Kind,
): string | null {
  if (typeof tracks === "string" || !row.video) return null;
  const describe = (path: string, index: number | null, full: boolean) => {
    const p = probes[path];
    const t = typeof p === "object" ? p.tracks.find((x) => x.index === index) : undefined;
    if (!t) return index === null ? "Réf. auto" : `@${index}`;
    return full ? `@${t.index} ${t.language ?? "?"} (${t.codec})${t.title ? ` « ${t.title} »` : ""}${t.forced ? " forcés" : ""}` : `@${t.index} ${t.language ?? "?"}`;
  };
  const reference = describe(row.video, tracks.reference.index, false);
  if (kind === "multi") return `${reference} → ${describe(row.video, tracks.target.index, true)}`;
  const target = tracks.target.index === null ? fileName(tracks.target.path) : describe(tracks.target.path, tracks.target.index, true);
  return `${reference} → ${target}`;
}

/** "Choisir": a row's tracks picked by hand, from Bobine Audio's track
 * table -- the reference among the reference video's tracks, the track to
 * correct among `target`'s (the same video in multi; none when the file to
 * correct is a subtitle file). */
function ChooseTracksDialog({
  reference,
  target,
  current,
  onClose,
  onSave,
}: {
  reference: ProbeResponse;
  target: ProbeResponse | null;
  current: { reference: number | null; target: number | null } | null;
  onClose: () => void;
  onSave: (choice: TrackChoice) => void;
}) {
  const usable = reference.tracks.filter((t) => t.format !== null);
  const sameFile = target?.path === reference.path;
  const [ref, setRef] = useState<number | null>(current?.reference ?? usable.find((t) => !t.forced)?.index ?? usable[0]?.index ?? null);
  const [tgt, setTgt] = useState<number | null>(current?.target ?? null);
  const targets = textTracks(target);
  const valid = ref !== null && (target === null || (tgt !== null && !(sameFile && tgt === ref)));

  const table = (probe: ProbeResponse, pickReference: boolean, pickTarget: boolean, name: string) => (
    <div className="tracks-table-wrap">
      <table className="batch-tracks-table">
        <thead>
          <tr>
            <th>Piste</th>
            <th>Langue</th>
            <th>Format</th>
            <th>Titre</th>
            {pickReference && <th className="track-pick">Réf.</th>}
            {pickTarget && <th className="track-pick">À corriger</th>}
          </tr>
        </thead>
        <tbody>
          {probe.tracks.map((t) => (
            <tr key={t.index}>
              <td>@{t.index}</td>
              <td>
                {t.language ?? "?"}
                {t.forced && <span className="track-forced"> (F)</span>}
              </td>
              <td>{t.codec}</td>
              <td className="batch-choice-title">{t.title ?? ""}</td>
              {pickReference && (
                <td className="track-pick">
                  <input type="radio" name={`${name}-ref`} checked={ref === t.index} disabled={t.format === null} onChange={() => setRef(t.index)} />
                </td>
              )}
              {pickTarget && (
                <td className="track-pick">
                  <input
                    type="radio"
                    name={`${name}-target`}
                    checked={tgt === t.index}
                    disabled={!targets.some((x) => x.index === t.index) || (sameFile && ref === t.index)}
                    onChange={() => setTgt(t.index)}
                  />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <Dialog onClose={onClose} className="batch-choice-panel" labelledBy="choice-title">
      <DialogHeader id="choice-title" title={`Pistes de ${fileName(reference.path)}`} titleTooltip={reference.path} onClose={onClose} closeLabel="Annuler" />
      {sameFile ? (
        table(reference, true, true, "multi")
      ) : (
        <>
          <h3 className="batch-choice-heading">Référence · {fileName(reference.path)}</h3>
          {table(reference, true, false, "ref")}
          {target && (
            <>
              <h3 className="batch-choice-heading">À corriger · {fileName(target.path)}</h3>
              {table(target, false, true, "target")}
            </>
          )}
        </>
      )}
      <div className="batch-choice-actions">
        <button className="primary-button" disabled={!valid} onClick={() => valid && onSave({ reference: ref!, target: target ? tgt : null })}>
          Valider
        </button>
      </div>
    </Dialog>
  );
}

/** Where a row stands, for the colored bar at its left (as Bobine Audio's
 * analyzed tracks): running, waiting, analyzed, exported, failed, or
 * nothing done yet. */
function rowState(runs: RowRuns, problem: string | null): string {
  const { analysis, render } = runs;
  if (analysis.status === "running" || render.status === "running") return "running";
  if (runs.queued) return "queued";
  if (analysis.status === "error" || render.status === "error" || (problem && problem !== "Lecture…")) return "error";
  if (render.status === "done") return "exported";
  if (analysis.status === "done") return "analyzed";
  return "idle";
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
  onReanalyze,
  manual,
  onChoose,
  onByLanguage,
  exporting,
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
  /** Pairs: which side's file; multi: the file. */
  onRemove: (side: "video" | "target") => void;
  onEdit: () => void;
  /** Analyzes this row alone again (its hand edits are lost). */
  onReanalyze: (() => void) | null;
  /** Its tracks were picked by hand. */
  manual: boolean;
  /** Picks its tracks by hand (null until its video's tracks are read). */
  onChoose: (() => void) | null;
  onByLanguage: () => void;
  /** An export is running: no edit meanwhile (it would change what's written). */
  exporting: boolean;
}) {
  const chooseButtons = (
    <span className="batch-tracks-actions">
      <button className="small-button" disabled={busy || !onChoose} onClick={() => onChoose?.()} title="Choisir à la main la référence et la piste à corriger de cette ligne">
        Choisir
      </button>
      {manual && (
        <button className="small-button" disabled={busy} onClick={onByLanguage} title="Revenir au choix par langue">
          Par langue
        </button>
      )}
    </span>
  );
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
    <tr className={`batch-row-state-${rowState(runs, problem)}${problem ? " batch-row-flagged" : ""}`}>
      <td className="batch-index">{index + 1}</td>
      <td className="batch-file">
        <div className="batch-file-inner">
          <span className="batch-filename" title={row.video ?? ""}>
            {row.video ? fileName(row.video) : "—"}
          </span>
          <span className="batch-file-actions">
            <button className="small-button" onClick={() => onRemove("video")} disabled={busy || !row.video} title="Retirer">
              ✕
            </button>
          </span>
        </div>
      </td>
      {kind === "pairs" ? (
        <td className="batch-file">
          <div className="batch-file-inner">
            <span className="batch-filename" title={row.target ?? ""}>
              {row.target ? fileName(row.target) : "—"}
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
              <button className="small-button" onClick={() => onRemove("target")} disabled={busy || !row.target} title="Retirer">
                ✕
              </button>
            </span>
          </div>
          <div className="batch-tracks-line batch-target-track">
            <span className={targetLabel || !problem ? "batch-tracks-summary" : "batch-tracks-summary batch-track-status-error"}>
              {targetLabel ?? problem ?? "Lecture des pistes..."}
              {manual && <span className="batch-track-status"> (manuel)</span>}
            </span>
            {chooseButtons}
          </div>
        </td>
      ) : (
        <td className="batch-tracks-cell">
          <div className="batch-tracks-line">
            <span className="batch-tracks-summary">
              {targetLabel ?? <span className="batch-track-status">{problem ?? "Lecture des pistes..."}</span>}
              {manual && <span className="batch-track-status"> (manuel)</span>}
            </span>
            {chooseButtons}
          </div>
        </td>
      )}
      <td className={`batch-status batch-status-${problem && analysis.status === "idle" ? "error" : analysisClass}`}>
        <div className="batch-analysis-cell">
          <div className="batch-analysis-text">
            {problem && analysis.status === "idle" && problem}
            {!problem && analysis.status === "idle" && (runs.queued ? "En attente" : "À analyser")}
            {analysis.status === "running" && "Analyse en cours..."}
            {analysis.status === "error" && (analysis.error ?? "Erreur")}
            {analysis.status === "cancelled" && "Annulé"}
            {analysis.status === "done" && result && (
              <>
                {summarize(result)}
                {result.ratio_name && <span className="drift-text"> · dérive</span>}
                {runs.edited && " · modifié"}
                {weak && <span className="batch-issues">⚠ à vérifier</span>}
              </>
            )}
          </div>
          <div className="batch-row-buttons">
            {analysis.status === "done" && result && (
              <button className="small-button" disabled={exporting} onClick={onEdit}>
                Modifier
              </button>
            )}
            {onReanalyze && (analysis.status === "done" || analysis.status === "error" || analysis.status === "cancelled") && (
              <button
                className="small-button icon-small-button"
                disabled={busy}
                onClick={onReanalyze}
                aria-label="Réanalyser"
                title={runs.edited ? "Réanalyser cette ligne seule : ses modifications faites avec « Modifier » sont perdues." : "Réanalyser cette ligne seule"}
              >
                <RedoIcon />
              </button>
            )}
          </div>
        </div>
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
          <button
            className="small-button icon-small-button"
            title="Ouvrir le dossier du fichier écrit"
            aria-label="Ouvrir le dossier du fichier écrit"
            onClick={() => revealItemInDir(render.result!.path)}
          >
            <FolderIcon />
          </button>
        )}
      </td>
    </tr>
  );
}
