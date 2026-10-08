import { useEffect, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
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
  type Segment,
  runJob,
  startAnalyze,
  startRender,
  type TrackRef,
} from "./api";
import AnalysisView, { analysisDuration } from "./AnalysisView";
import { withSegments } from "./retime";
import SegmentEditor from "./SegmentEditor";
import { DropOverlay, useFileDrop } from "./FileDrop";
import { clock, fileName, isSubtitleFile, trackLabel } from "./format";
import { errorMessage, IDLE, LANGUAGES, pickFile, type Run, textTracks } from "./shared";
import { InfoTip } from "./InfoTip";

export default function SingleView({ active }: { active: boolean }) {
  const [reference, setReference] = useState<ProbeResponse | null>(null);
  const [referenceIndex, setReferenceIndex] = useState<number | null>(null); // null: automatic
  const [targetMode, setTargetMode] = useState<"same" | "file">("file");
  const [targetFile, setTargetFile] = useState<ProbeResponse | null>(null);
  const [targetIndex, setTargetIndex] = useState<number | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Run<Analysis>>(IDLE);

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
      setOpenError(errorMessage(e));
    } finally {
      setOpening(null);
    }
  };

  // A video dropped is the reference, a subtitle file the target.
  const drag = useFileDrop(active, analysis.status === "running" ? "Attends la fin de l'analyse." : null, async (files) => {
    const video = files.find((f) => !isSubtitleFile(f));
    const subtitle = files.find(isSubtitleFile);
    if (video) await load("reference", video);
    if (subtitle) {
      setTargetMode("file");
      await load("target", subtitle);
    }
  });

  // Dev only: lets automated UI checks open files without the native dialog.
  useEffect(() => {
    if (!import.meta.env.DEV || !active) return;
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
      else setAnalysis((a) => ({ ...a, status: "error", error: errorMessage(e) }));
    }
  };

  const duration = analysis.result ? analysisDuration(analysis.result, reference?.duration ?? null) : 0;

  return (
    <div className="view" hidden={!active}>
      <div className="layout">
        <aside className="sidebar">
          <section className="card">
            <h2>
              Référence <InfoTip>La vidéo dont les sous-titres sont déjà bien calés (ou un SRT/ASS calé).</InfoTip>
            </h2>
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
            <h2>
              À corriger <InfoTip>Une piste de la référence, un fichier SRT/ASS, ou une vidéo contenant la piste à corriger.</InfoTip>
            </h2>
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
            <Results key={analysis.jobId} analysis={analysis.result} duration={duration} referenceIsVideo={reference.kind === "container"} sameFile={targetMode === "same"} />
          )}
        </main>
      </div>
      <DropOverlay
        drag={drag}
        blocked={analysis.status === "running" ? "Attends la fin de l'analyse." : null}
        label="Ouvrir"
        hint="Une vidéo : la référence · un SRT/ASS : les sous-titres à corriger"
      />
    </div>
  );
}

function EmptyState({ hasReference }: { hasReference: boolean }) {
  return (
    <div className="placeholder">
      <div className="placeholder-title">{hasReference ? "Choisis les sous-titres à corriger, puis lance l'analyse." : "Ouvre la vidéo de référence pour commencer."}</div>
      <p>
        Bobine Subs compare le rythme des répliques des deux pistes (quand elles s'affichent, quand elles s'arrêtent) : ça marche d'une langue à
        l'autre, et retrouve décalage, dérive et sauts.
      </p>
    </div>
  );
}

function Results({
  analysis: detected,
  duration,
  referenceIsVideo,
  sameFile,
}: {
  analysis: Analysis;
  duration: number;
  referenceIsVideo: boolean;
  sameFile: boolean;
}) {
  // Hand-edited segments, if any (a new analysis starts from scratch:
  // this component is remounted with it).
  const [edited, setEdited] = useState<Segment[] | null>(null);
  const [editing, setEditing] = useState(false);
  const analysis = edited ? withSegments(detected, edited) : detected;
  return (
    <div className="results-content">
      <AnalysisView analysis={analysis} duration={duration} edited={edited !== null} onEdit={() => setEditing(true)} />
      <ExportCard key={JSON.stringify(analysis.segments)} analysis={analysis} referenceIsVideo={referenceIsVideo} sameFile={sameFile} />
      {editing && (
        <SegmentEditor
          analysis={analysis}
          duration={duration}
          onClose={() => setEditing(false)}
          onSave={(segments) => {
            setEdited(segments);
            setEditing(false);
          }}
        />
      )}
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
      else setRun((r) => ({ ...r, status: "error", error: errorMessage(e) }));
    }
  };

  const running = run.status === "running";
  return (
    <section className="card">
      <h2>
        Exporter{" "}
        <InfoTip>
          {subsOnly
            ? "Écrit le fichier de sous-titres corrigé."
            : sameFile
              ? "Copie la vidéo dans un nouveau MKV où la piste corrigée remplace l'originale. Rien n'est réencodé, le fichier d'origine n'est pas modifié."
              : "Copie la vidéo dans un nouveau MKV avec les sous-titres corrigés en piste supplémentaire. Rien n'est réencodé, le fichier d'origine n'est pas modifié."}
        </InfoTip>
      </h2>
      <div className="segmented">
        <button className={!subsOnly ? "active" : ""} onClick={() => { edited.current = false; setSubsOnly(false); }} disabled={!referenceIsVideo || running}>
          Nouveau MKV
        </button>
        <button className={subsOnly ? "active" : ""} onClick={() => { edited.current = false; setSubsOnly(true); }} disabled={running}>
          Sous-titres seuls
        </button>
      </div>
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

