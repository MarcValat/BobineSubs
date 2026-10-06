import { useEffect, useRef, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  type Analysis,
  cancelJob,
  defaultOutput,
  JobCancelled,
  pathExists,
  probe,
  type ProbeResponse,
  type RenderResult,
  runJob,
  startAnalyze,
  startRender,
  type TrackRef,
} from "./api";
import { retryEngine, useEngineStatus } from "./engine";
import { clock, fileName, offset, SUBTITLE_EXTENSIONS, trackLabel, VIDEO_EXTENSIONS } from "./format";
import Timeline from "./Timeline";

const LOW_CONFIDENCE = 0.8;
const LANGUAGES = [
  ["fre", "Français"],
  ["eng", "Anglais"],
  ["spa", "Espagnol"],
  ["ger", "Allemand"],
  ["ita", "Italien"],
  ["por", "Portugais"],
  ["jpn", "Japonais"],
];

type Status = "idle" | "running" | "done" | "error" | "cancelled";

interface Run<T> {
  status: Status;
  log: readonly string[];
  result?: T;
  error?: string;
  jobId?: string;
}

const IDLE = { status: "idle", log: [] } as const;

async function pickFile(title: string, subtitlesFirst = false): Promise<string | null> {
  const video = { name: "Vidéos", extensions: VIDEO_EXTENSIONS };
  const subs = { name: "Sous-titres", extensions: SUBTITLE_EXTENSIONS };
  const all = { name: "Vidéos et sous-titres", extensions: [...VIDEO_EXTENSIONS, ...SUBTITLE_EXTENSIONS] };
  const picked = await open({ title, multiple: false, filters: subtitlesFirst ? [subs, all, video] : [all, video, subs] });
  return typeof picked === "string" ? picked : null;
}

export default function App() {
  const [reference, setReference] = useState<ProbeResponse | null>(null);
  const [referenceIndex, setReferenceIndex] = useState<number | null>(null); // null: automatic
  const [targetMode, setTargetMode] = useState<"same" | "file">("file");
  const [targetFile, setTargetFile] = useState<ProbeResponse | null>(null);
  const [targetIndex, setTargetIndex] = useState<number | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Run<Analysis>>(IDLE);

  const textTracks = (p: ProbeResponse | null) => p?.tracks.filter((t) => t.format === "srt" || t.format === "ass") ?? [];
  const usableReferences = reference?.tracks.filter((t) => t.format !== null) ?? [];

  const targetSource = targetMode === "same" ? reference : targetFile;
  const target: TrackRef | null = targetSource
    ? targetSource.kind === "subtitles"
      ? { path: targetSource.path, index: null }
      : targetIndex !== null
        ? { path: targetSource.path, index: targetIndex }
        : null
    : null;
  const referenceRef: TrackRef | null = reference
    ? { path: reference.path, index: reference.kind === "subtitles" ? null : referenceIndex }
    : null;
  const sameTrack = targetMode === "same" && referenceIndex !== null && referenceIndex === targetIndex;
  const canAnalyze = referenceRef !== null && target !== null && !sameTrack && analysis.status !== "running";

  // Any change of input makes a previous result stale.
  useEffect(() => setAnalysis(IDLE), [reference, referenceIndex, targetMode, targetFile, targetIndex]);

  const open_ = async (role: "reference" | "target") => {
    const path = await pickFile(role === "reference" ? "Fichier de référence" : "Sous-titres à corriger", role === "target");
    if (path) await load(role, path);
  };

  const load = async (role: "reference" | "target", path: string) => {
    setOpenError(null);
    setOpening(role);
    try {
      const probed = await probe(path);
      if (probed.kind === "container" && probed.tracks.length === 0) throw new Error(`${fileName(path)} ne contient aucune piste de sous-titres.`);
      if (role === "reference") {
        setReference(probed);
        setReferenceIndex(null);
        // A video with a second text track: correcting one of its own
        // tracks is the likely intent.
        const text = textTracks(probed);
        if (probed.kind === "container" && text.length >= 2) {
          setTargetMode("same");
          setTargetIndex(text.find((t) => t.default)?.index ?? text[text.length - 1].index);
        } else {
          setTargetMode("file");
          setTargetIndex(null);
        }
      } else {
        setTargetFile(probed);
        const text = textTracks(probed);
        setTargetIndex(probed.kind === "container" ? (text[0]?.index ?? null) : null);
      }
    } catch (e) {
      setOpenError(String(e instanceof Error ? e.message : e));
    } finally {
      setOpening(null);
    }
  };

  // Dev only: lets automated UI checks open files without the native dialog.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __test?: object }).__test = { load };
  });

  const analyze = async () => {
    if (!referenceRef || !target) return;
    setAnalysis({ status: "running", log: [] });
    try {
      const result = await runJob<Analysis>(
        startAnalyze(referenceRef, target),
        (message) => setAnalysis((a) => ({ ...a, log: [...a.log, message] })),
        (jobId) => setAnalysis((a) => ({ ...a, jobId })),
      );
      setAnalysis((a) => ({ ...a, status: "done", result }));
    } catch (e) {
      if (e instanceof JobCancelled) setAnalysis((a) => ({ ...a, status: "cancelled" }));
      else setAnalysis((a) => ({ ...a, status: "error", error: String(e instanceof Error ? e.message : e) }));
    }
  };

  const duration = Math.max(
    reference?.duration ?? 0,
    ...(analysis.result?.reference_cues.map(([, b]) => b) ?? [0]),
    ...(analysis.result?.target_cues.map((c) => c.corrected?.[1] ?? 0) ?? [0]),
  );

  return (
    <div className="app">
      <div className="layout">
        <aside className="sidebar">
          <EngineBadge />
          <section className="card">
            <h2>Référence</h2>
            <p className="hint">La vidéo dont les sous-titres sont déjà bien calés (ou un SRT/ASS calé).</p>
            <button className="primary wide" onClick={() => open_("reference")} disabled={opening !== null}>
              {opening === "reference" ? "Lecture…" : reference ? "Changer de fichier…" : "Ouvrir un fichier…"}
            </button>
            {reference && (
              <>
                <div className="file-name" title={reference.path}>
                  {fileName(reference.path)}
                </div>
                {reference.kind === "container" && (
                  <label className="field">
                    <span>Piste de référence</span>
                    <select
                      value={referenceIndex ?? "auto"}
                      onChange={(e) => setReferenceIndex(e.target.value === "auto" ? null : Number(e.target.value))}
                    >
                      <option value="auto">Automatique (la plus complète)</option>
                      {usableReferences.map((t) => (
                        <option key={t.index} value={t.index}>
                          {trackLabel(t)}
                          {t.format === "pgs" || t.format === "vobsub" ? " (image)" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </>
            )}
          </section>

          <section className="card">
            <h2>À corriger</h2>
            {reference?.kind === "container" && textTracks(reference).length > 0 && (
              <div className="segmented">
                <button className={targetMode === "same" ? "active" : ""} onClick={() => setTargetMode("same")}>
                  Piste de ce fichier
                </button>
                <button className={targetMode === "file" ? "active" : ""} onClick={() => setTargetMode("file")}>
                  Autre fichier
                </button>
              </div>
            )}
            {targetMode === "same" && reference ? (
              <label className="field">
                <span>Piste à corriger</span>
                <select value={targetIndex ?? ""} onChange={(e) => setTargetIndex(Number(e.target.value))}>
                  {textTracks(reference).map((t) => (
                    <option key={t.index} value={t.index}>
                      {trackLabel(t)}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <>
                <p className="hint">Un fichier SRT/ASS, ou une vidéo contenant la piste à corriger.</p>
                <button className="wide" onClick={() => open_("target")} disabled={opening !== null}>
                  {opening === "target" ? "Lecture…" : targetFile ? "Changer de fichier…" : "Choisir les sous-titres…"}
                </button>
                {targetFile && (
                  <>
                    <div className="file-name" title={targetFile.path}>
                      {fileName(targetFile.path)}
                      {targetFile.cue_count !== null && <span className="muted"> · {targetFile.cue_count} répliques</span>}
                    </div>
                    {targetFile.kind === "container" && (
                      <label className="field">
                        <span>Piste à corriger</span>
                        <select value={targetIndex ?? ""} onChange={(e) => setTargetIndex(Number(e.target.value))}>
                          {textTracks(targetFile).map((t) => (
                            <option key={t.index} value={t.index}>
                              {trackLabel(t)}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </>
                )}
              </>
            )}
            {sameTrack && <p className="error">La référence et la piste à corriger sont la même piste.</p>}
          </section>

          {openError && <p className="error">{openError}</p>}

          <button className="primary wide big" onClick={analyze} disabled={!canAnalyze}>
            {analysis.status === "running" ? "Analyse en cours…" : "Analyser"}
          </button>
          {analysis.status === "running" && analysis.jobId && (
            <button className="wide" onClick={() => cancelJob(analysis.jobId!)}>
              Annuler
            </button>
          )}
          {analysis.log.length > 0 && (
            <details className="log" open={analysis.status === "running"}>
              <summary>Journal</summary>
              {analysis.log.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </details>
          )}
        </aside>

        <main className="results">
          {analysis.status === "idle" && <EmptyState hasReference={reference !== null} />}
          {analysis.status === "running" && <div className="placeholder">Analyse en cours…</div>}
          {analysis.status === "cancelled" && <div className="placeholder">Analyse annulée.</div>}
          {analysis.status === "error" && (
            <div className="card">
              <h2>L'analyse a échoué</h2>
              <p className="error">{analysis.error}</p>
            </div>
          )}
          {analysis.status === "done" && analysis.result && reference && (
            <Results analysis={analysis.result} duration={duration} referenceIsVideo={reference.kind === "container"} sameFile={targetMode === "same"} />
          )}
        </main>
      </div>
    </div>
  );
}

function EngineBadge() {
  const status = useEngineStatus();
  if (status === "ready") return null;
  return (
    <span className={`engine-badge ${status}`}>
      {status === "starting" ? (
        "Démarrage du moteur…"
      ) : (
        <>
          Moteur injoignable <button onClick={retryEngine}>Réessayer</button>
        </>
      )}
    </span>
  );
}

function EmptyState({ hasReference }: { hasReference: boolean }) {
  return (
    <div className="placeholder">
      <div className="placeholder-title">{hasReference ? "Choisis les sous-titres à corriger, puis lance l'analyse." : "Ouvre la vidéo de référence pour commencer."}</div>
      <p>
        SyncSubtitles compare le rythme des répliques des deux pistes (quand elles s'affichent, quand elles s'arrêtent) : ça marche d'une langue à
        l'autre, et retrouve décalage, dérive et sauts.
      </p>
    </div>
  );
}

function Results({
  analysis,
  duration,
  referenceIsVideo,
  sameFile,
}: {
  analysis: Analysis;
  duration: number;
  referenceIsVideo: boolean;
  sameFile: boolean;
}) {
  const segments = analysis.segments;
  const counts = segments.map((_, g) => analysis.target_cues.filter((c) => c.group === g).length);
  const orphans = analysis.target_cues.filter((c) => c.group < 0).length;
  const dropped = analysis.target_cues.filter((c) => c.corrected === null || c.corrected[1] <= 0).length;
  const summary =
    segments.length === 1
      ? `Décalage constant de ${offset(segments[0].offset_start)}`
      : `${segments.length - 1} saut${segments.length > 2 ? "s" : ""}, ${segments.length} segments`;

  return (
    <div className="results-content">
      <section className="card">
        <div className="summary">
          <div>
            <h2>{summary}</h2>
            {analysis.ratio_name && <div className="badge">Dérive : {analysis.ratio_name}</div>}
            {analysis.reference_choice && <div className="muted">Référence : piste {analysis.reference_choice}</div>}
          </div>
          <div className="muted right">
            {analysis.reference_cues.length} répliques de référence · {analysis.target_cues.length} à corriger
            {orphans > 0 && <div>{orphans} sans équivalent (ou non dialoguées)</div>}
            {dropped > 0 && <div className="warn-text">{dropped} seront retirées</div>}
          </div>
        </div>
        {analysis.warnings.map((w) => (
          <p key={w} className="warning">
            ⚠ {w}
          </p>
        ))}
        <Timeline analysis={analysis} duration={duration} />
      </section>

      <section className="card">
        <h2>Segments</h2>
        <table className="segments">
          <thead>
            <tr>
              <th>Début</th>
              <th>Fin</th>
              <th>Décalage</th>
              <th>Répliques</th>
              <th>Confiance</th>
            </tr>
          </thead>
          <tbody>
            {segments.map((s, i) => (
              <tr key={i} className={s.confidence < LOW_CONFIDENCE ? "weak" : ""}>
                <td>{clock(s.start_s)}</td>
                <td>{clock(Math.min(s.end_s, duration))}</td>
                <td className="num">
                  {offset(s.offset_start)}
                  {Math.abs(s.offset_end - s.offset_start) > 0.05 && ` → ${offset(s.offset_end)}`}
                </td>
                <td className="num">{counts[i]}</td>
                <td className="num">
                  {Math.round(s.confidence * 100)} %{s.confidence < LOW_CONFIDENCE && " ⚠"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <ExportCard analysis={analysis} referenceIsVideo={referenceIsVideo} sameFile={sameFile} />
    </div>
  );
}

function ExportCard({ analysis, referenceIsVideo, sameFile }: { analysis: Analysis; referenceIsVideo: boolean; sameFile: boolean }) {
  const [subsOnly, setSubsOnly] = useState(!referenceIsVideo);
  const [output, setOutput] = useState("");
  const [overwrite, setOverwrite] = useState(false);
  const [language, setLanguage] = useState("");
  const [title, setTitle] = useState("");
  const [makeDefault, setMakeDefault] = useState(false);
  const [run, setRun] = useState<Run<RenderResult>>(IDLE);
  const edited = useRef(false);

  useEffect(() => {
    if (edited.current) return;
    defaultOutput(analysis.reference.path, analysis.target, subsOnly).then(setOutput, () => {});
  }, [analysis, subsOnly]);

  useEffect(() => {
    if (!output) return;
    pathExists(output).then(setOverwrite, () => setOverwrite(false));
  }, [output, run.status]);

  const choose = async () => {
    const extension = subsOnly ? (output.split(".").pop() ?? "srt") : "mkv";
    const picked = await save({
      defaultPath: output || undefined,
      filters: [subsOnly ? { name: "Sous-titres", extensions: [extension] } : { name: "Vidéo MKV", extensions: ["mkv"] }],
    });
    if (picked) {
      edited.current = true;
      setOutput(picked);
    }
  };

  const exportNow = async () => {
    setRun({ status: "running", log: [] });
    try {
      const result = await runJob<RenderResult>(
        startRender(analysis.reference, analysis.target, analysis.segments, {
          output: output || null,
          subs_only: subsOnly,
          language: language || null,
          title: title || null,
          default: sameFile ? null : makeDefault,
        }),
        (message) => setRun((r) => ({ ...r, log: [...r.log, message] })),
        (jobId) => setRun((r) => ({ ...r, jobId })),
      );
      setRun((r) => ({ ...r, status: "done", result }));
    } catch (e) {
      if (e instanceof JobCancelled) setRun((r) => ({ ...r, status: "cancelled" }));
      else setRun((r) => ({ ...r, status: "error", error: String(e instanceof Error ? e.message : e) }));
    }
  };

  const running = run.status === "running";
  return (
    <section className="card">
      <h2>Exporter</h2>
      <div className="segmented">
        <button className={!subsOnly ? "active" : ""} onClick={() => { edited.current = false; setSubsOnly(false); }} disabled={!referenceIsVideo || running}>
          Nouveau MKV
        </button>
        <button className={subsOnly ? "active" : ""} onClick={() => { edited.current = false; setSubsOnly(true); }} disabled={running}>
          Sous-titres seuls
        </button>
      </div>
      <p className="hint">
        {subsOnly
          ? "Écrit le fichier de sous-titres corrigé."
          : sameFile
            ? "Copie la vidéo dans un nouveau MKV où la piste corrigée remplace l'originale. Rien n'est réencodé, le fichier d'origine n'est pas modifié."
            : "Copie la vidéo dans un nouveau MKV avec les sous-titres corrigés en piste supplémentaire. Rien n'est réencodé, le fichier d'origine n'est pas modifié."}
      </p>
      <div className="output-row">
        <input value={output} onChange={(e) => { edited.current = true; setOutput(e.target.value); }} spellCheck={false} disabled={running} />
        <button onClick={choose} disabled={running}>
          Parcourir…
        </button>
      </div>
      {overwrite && run.status !== "done" && <p className="warning">⚠ Ce fichier existe déjà : il sera remplacé.</p>}
      {!subsOnly && !sameFile && (
        <div className="options-row">
          <label className="field inline">
            <span>Langue</span>
            <select value={language} onChange={(e) => setLanguage(e.target.value)} disabled={running}>
              <option value="">Automatique (nom du fichier)</option>
              {LANGUAGES.map(([code, name]) => (
                <option key={code} value={code}>
                  {name} ({code})
                </option>
              ))}
            </select>
          </label>
          <label className="field inline">
            <span>Titre</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="ex. Français" disabled={running} />
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} disabled={running} />
            Piste par défaut
          </label>
        </div>
      )}
      <div className="actions">
        <button className="primary big" onClick={exportNow} disabled={running || !output}>
          {running ? "Export en cours…" : "Exporter"}
        </button>
        {running && run.jobId && <button onClick={() => cancelJob(run.jobId!)}>Annuler</button>}
      </div>
      {run.status === "done" && run.result && (
        <div className="success">
          <div>
            ✓ Écrit : <strong>{fileName(run.result.path)}</strong>
            {run.result.kind !== "subtitles" && ` (piste ${run.result.kind === "replaced" ? "remplacée" : "ajoutée"})`}
          </div>
          <button onClick={() => revealItemInDir(run.result!.path)}>Afficher dans le dossier</button>
        </div>
      )}
      {run.status === "done" && run.result && run.result.dropped.length > 0 && (
        <details className="log">
          <summary>{run.result.dropped.length} réplique(s) retirée(s)</summary>
          {run.result.dropped.map((d, i) => (
            <div key={i}>
              {clock(d.start)} · {d.text}
            </div>
          ))}
        </details>
      )}
      {run.status === "cancelled" && <p className="muted">Export annulé, aucun fichier écrit.</p>}
      {run.status === "error" && <p className="error">{run.error}</p>}
    </section>
  );
}

