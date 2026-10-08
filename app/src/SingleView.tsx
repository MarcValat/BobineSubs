import { useEffect, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  type Analysis,
  cancelJob,
  defaultOutput,
  JobCancelled,
  probe,
  type ProbeResponse,
  type RenderResult,
  type Segment,
  runJob,
  startAnalyze,
  startRender,
  type TrackInfo,
  type TrackRef,
} from "./api";
import AnalysisView, { analysisDuration } from "./AnalysisView";
import { withSegments } from "./retime";
import SegmentEditor from "./SegmentEditor";
import { DropOverlay, useFileDrop } from "./FileDrop";
import { DropZone } from "./DropZone";
import { clock, fileName, isSubtitleFile } from "./format";
import { InfoTip } from "./InfoTip";
import { LogPanel } from "./LogPanel";
import { PillSwitch } from "./PillSwitch";
import { errorMessage, IDLE, LANGUAGES, languageName, pickFile, type Run, textTracks } from "./shared";

const EXPORT_KINDS = [
  ["mkv", "Nouveau MKV"],
  ["subs", "Sous-titres seuls"],
] as const;

/** Where the track to correct comes from: the opened file, or another one. */
type Source = "same" | "file";

/** The single-file mode, laid out as Bobine Audio's: on the left, the file
 * opened, its tracks (reference and track to correct) and the export; on
 * the right, the analysis. */
export default function SingleView({ active }: { active: boolean }) {
  const [reference, setReference] = useState<ProbeResponse | null>(null);
  const [referenceIndex, setReferenceIndex] = useState<number | null>(null); // null: automatic
  const [targetMode, setTargetMode] = useState<Source>("file");
  const [targetFile, setTargetFile] = useState<ProbeResponse | null>(null);
  const [targetIndex, setTargetIndex] = useState<number | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Run<Analysis>>(IDLE);
  // Hand-edited segments, if any (a new analysis starts from scratch).
  const [edited, setEdited] = useState<Segment[] | null>(null);
  const [editing, setEditing] = useState(false);

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
  // Only the reference to work with: what's to correct is still to add.
  const nothingToCorrect = reference !== null && targetFile === null && (reference.kind === "subtitles" || textTracks(reference).length < 2);
  const canAnalyze = referenceRef !== null && target !== null && !sameTrack && analysis.status !== "running";

  // Any change of input makes a previous result stale.
  useEffect(() => {
    setAnalysis(IDLE);
    setEdited(null);
  }, [reference, referenceIndex, targetMode, targetFile, targetIndex]);

  const load = async (role: "reference" | "target", path: string) => {
    setOpenError(null);
    setOpening(role);
    try {
      const probed = await probe(path);
      if (probed.kind === "container" && probed.tracks.length === 0) throw new Error(`${fileName(path)} ne contient aucune piste de sous-titres.`);
      if (role === "reference") {
        setReference(probed);
        setReferenceIndex(null);
        setTargetFile(null);
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
        setTargetMode("file");
        const text = textTracks(probed);
        setTargetIndex(probed.kind === "container" ? (text[0]?.index ?? null) : null);
      }
    } catch (e) {
      setOpenError(errorMessage(e));
    } finally {
      setOpening(null);
    }
  };

  const openReference = async () => {
    const path = await pickFile("Ouvrir un fichier");
    if (path) await load("reference", path);
  };
  const addTarget = async () => {
    const path = await pickFile("Sous-titres à corriger", true);
    if (path) await load("target", path);
  };

  // A video dropped is the reference, a subtitle file the target.
  const drag = useFileDrop(active, analysis.status === "running" ? "Attends la fin de l'analyse." : null, async (files) => {
    const video = files.find((f) => !isSubtitleFile(f));
    const subtitle = files.find(isSubtitleFile);
    if (video) await load("reference", video);
    else if (subtitle && !reference) {
      await load("reference", subtitle);
      return;
    }
    if (subtitle) await load("target", subtitle);
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

  const detected = analysis.status === "done" ? (analysis.result ?? null) : null;
  const shown = detected && edited ? withSegments(detected, edited) : detected;
  const duration = shown ? analysisDuration(shown, reference?.duration ?? null) : 0;
  const running = analysis.status === "running";

  return (
    <main className="app-main" hidden={!active}>
      <div className="left-column">
        <button className="primary-button file-open-button" onClick={openReference} disabled={opening !== null || running}>
          Ouvrir un fichier
        </button>

        <section className="panel field-tracks">
          <h2>
            Pistes{" "}
            <InfoTip>
              La référence : une piste de sous-titres déjà bien calée (choisie automatiquement : la plus complète). À corriger : une piste du même
              fichier, ou d'un fichier ajouté (SRT/ASS, ou une vidéo qui la contient).
            </InfoTip>
          </h2>
          {reference && (
            <p className="file-path" title={reference.path}>
              {fileName(reference.path)}
            </p>
          )}
          {!reference && !openError && (
            <p className="placeholder">{opening === "reference" ? "Lecture des pistes..." : "Ouvre un fichier pour voir ses pistes."}</p>
          )}
          {openError && <p className="error">{openError}</p>}
          {reference && (
            <>
              {nothingToCorrect ? (
                <>
                  <TrackPickers
                    reference={reference}
                    referenceIndex={referenceIndex}
                    targetFile={null}
                    targetMode={targetMode}
                    targetIndex={targetIndex}
                    disabled={running}
                    onReference={setReferenceIndex}
                    onTarget={() => {}}
                    onAddTarget={addTarget}
                    referenceOnly
                  />
                  <button className="tracks-add-main" onClick={addTarget} disabled={opening !== null || running}>
                    {opening === "target" ? "Lecture..." : "Ajouter les sous-titres à corriger…"}
                  </button>
                </>
              ) : (
                <TrackPickers
                  reference={reference}
                  referenceIndex={referenceIndex}
                  targetFile={targetFile}
                  targetMode={targetMode}
                  targetIndex={targetIndex}
                  disabled={running || opening !== null}
                  onReference={setReferenceIndex}
                  onTarget={(mode, index) => {
                    setTargetMode(mode);
                    setTargetIndex(index);
                  }}
                  onAddTarget={addTarget}
                />
              )}
              {sameTrack && <p className="error">La référence et la piste à corriger sont la même piste.</p>}
              <div className="tracks-actions">
                <button
                  className="primary-button"
                  onClick={analyze}
                  disabled={!canAnalyze}
                  title="Détecte le décalage de la piste à corriger par rapport à la référence (dérive et sauts nets inclus), avec la frise correspondante."
                >
                  {running ? "Analyse en cours..." : "Analyser"}
                </button>
                {running && analysis.jobId && (
                  <button className="small-button" onClick={() => cancelJob(analysis.jobId!)}>
                    Annuler
                  </button>
                )}
              </div>
              <LogPanel lines={analysis.log} />
            </>
          )}
        </section>

        {shown && reference && (
          <ExportPanel
            key={JSON.stringify(shown.segments)}
            analysis={shown}
            referenceIsVideo={reference.kind === "container"}
            sameFile={targetMode === "same"}
          />
        )}
      </div>

      <section className="panel field-analysis">
        <div className="analysis-header">
          <h2>{shown ? heading(shown, reference, targetSource) : "Analyse"}</h2>
          {shown && (
            <button className="small-button" onClick={() => setEditing(true)}>
              Modifier les segments
            </button>
          )}
        </div>
        <div className="analysis-scroll">
          {analysis.status === "idle" && !reference && (
            <DropZone title="Glisse une vidéo ici" onClick={openReference} disabled={opening !== null}>
              ou clique pour ouvrir un fichier : ses sous-titres serviront de référence.
            </DropZone>
          )}
          {analysis.status === "idle" && reference && nothingToCorrect && (
            <DropZone title="Glisse les sous-titres à corriger ici" onClick={addTarget} disabled={opening !== null}>
              ou clique pour les choisir : un SRT/ASS, ou une vidéo qui contient la piste à corriger.
            </DropZone>
          )}
          {analysis.status === "idle" && reference && !nothingToCorrect && (
            <p className="placeholder">Choisis la piste à corriger, puis clique sur « Analyser ».</p>
          )}
          {running && <p className="placeholder">Analyse en cours...</p>}
          {analysis.status === "cancelled" && <p className="placeholder">Annulé</p>}
          {analysis.status === "error" && <p className="error">{analysis.error}</p>}
          {shown && <AnalysisView analysis={shown} duration={duration} edited={edited !== null} />}
        </div>
      </section>

      {editing && shown && (
        <SegmentEditor
          analysis={shown}
          duration={duration}
          onClose={() => setEditing(false)}
          onSave={(segments) => {
            setEdited(segments);
            setEditing(false);
          }}
        />
      )}
      <DropOverlay
        drag={drag}
        blocked={running ? "Attends la fin de l'analyse." : null}
        label="Déposer pour ouvrir le fichier"
        hint="Une vidéo : la référence · un SRT/ASS : les sous-titres à corriger"
      />
    </main>
  );
}

/** "Piste @2 (fre) · référence @0 (eng)", as Bobine Audio's panel title. */
function heading(analysis: Analysis, reference: ProbeResponse | null, targetSource: ProbeResponse | null): string {
  const label = (probe: ProbeResponse | null, index: number | null) => {
    if (!probe || probe.kind === "subtitles" || index === null) return fileName(probe?.path ?? "");
    const track = probe.tracks.find((t) => t.index === index);
    return `@${index} (${track?.language ?? "?"})`;
  };
  // The automatic reference, as the engine reports it: "@0 (ass, eng, ...)".
  const chosen = analysis.reference.index ?? Number(/^@(\d+)/.exec(analysis.reference_choice ?? "")?.[1] ?? NaN);
  return `Piste ${label(targetSource, analysis.target.index)} · référence ${label(reference, Number.isNaN(chosen) ? null : chosen)}`;
}

/** "Piste @1 · Français · ASS · « Titre » · forcés": what tells tracks apart. */
function trackOption(track: TrackInfo): string {
  const parts = [`@${track.index}`, track.language ? `${languageName(track.language)}` : "langue inconnue", track.codec.toUpperCase()];
  if (track.title) parts.push(`« ${track.title} »`);
  if (track.forced) parts.push("forcés");
  if (track.format === "pgs" || track.format === "vobsub") parts.push("image");
  return parts.join(" · ");
}

/** The reference and the track to correct, one list each: a single pick
 * each (unlike Bobine Audio's several tracks to correct, hence not its
 * track table). The track to correct can come from the opened file or
 * from another one, added from the list itself ("Autre fichier…"). */
function TrackPickers({
  reference,
  referenceIndex,
  targetFile,
  targetMode,
  targetIndex,
  disabled,
  onReference,
  onTarget,
  onAddTarget,
  referenceOnly = false,
}: {
  reference: ProbeResponse;
  referenceIndex: number | null;
  targetFile: ProbeResponse | null;
  targetMode: Source;
  targetIndex: number | null;
  disabled: boolean;
  /** null: automatic (the engine's pick). */
  onReference: (index: number | null) => void;
  onTarget: (mode: Source, index: number | null) => void;
  onAddTarget: () => void;
  /** Nothing to correct yet: the reference's list only. */
  referenceOnly?: boolean;
}) {
  const usable = reference.tracks.filter((t) => t.format !== null);
  const ownText = textTracks(reference);
  const targetValue = targetMode === "same" ? `same:${targetIndex}` : targetFile ? `file:${targetFile.kind === "subtitles" ? "" : targetIndex}` : "";

  function pickTarget(value: string) {
    if (value === "add") return onAddTarget();
    const [mode, index] = value.split(":");
    onTarget(mode as Source, index === "" ? null : Number(index));
  }

  return (
    <div className="track-pickers">
      <label className="track-picker">
        <span>Référence</span>
        {reference.kind === "subtitles" ? (
          <select disabled>
            <option>{fileName(reference.path)}</option>
          </select>
        ) : (
          <select
            value={referenceIndex ?? "auto"}
            onChange={(e) => onReference(e.target.value === "auto" ? null : Number(e.target.value))}
            disabled={disabled}
          >
            <option value="auto">Automatique (la plus complète)</option>
            {usable.map((t) => (
              <option key={t.index} value={t.index}>
                {trackOption(t)}
              </option>
            ))}
          </select>
        )}
      </label>
      {!referenceOnly && (
      <label className="track-picker">
        <span>À corriger</span>
        <select value={targetValue} onChange={(e) => pickTarget(e.target.value)} disabled={disabled}>
          {targetValue === "" && <option value="">—</option>}
          {ownText.length > 0 && (
            <optgroup label={fileName(reference.path)}>
              {ownText.map((t) => (
                <option key={t.index} value={`same:${t.index}`} disabled={t.index === referenceIndex}>
                  {trackOption(t)}
                </option>
              ))}
            </optgroup>
          )}
          {targetFile && (
            <optgroup label={fileName(targetFile.path)}>
              {targetFile.kind === "subtitles" ? (
                <option value="file:">
                  {fileName(targetFile.path)}
                  {targetFile.cue_count !== null && ` · ${targetFile.cue_count} répliques`}
                </option>
              ) : (
                textTracks(targetFile).map((t) => (
                  <option key={t.index} value={`file:${t.index}`}>
                    {trackOption(t)}
                  </option>
                ))
              )}
            </optgroup>
          )}
          <option value="add">Autre fichier…</option>
        </select>
      </label>
      )}
    </div>
  );
}

/** The export, under the tracks as Bobine Audio's: what it writes, then the
 * button that asks where (the system's save dialog) and writes it. */
function ExportPanel({ analysis, referenceIsVideo, sameFile }: { analysis: Analysis; referenceIsVideo: boolean; sameFile: boolean }) {
  const [subsOnly, setSubsOnly] = useState(!referenceIsVideo);
  const [language, setLanguage] = useState("");
  const [title, setTitle] = useState("");
  const [makeDefault, setMakeDefault] = useState(false);
  const [run, setRun] = useState<Run<RenderResult>>(IDLE);
  const [cancelling, setCancelling] = useState(false);

  const exportFile = async () => {
    const suggested = await defaultOutput(analysis.reference.path, analysis.target, subsOnly).catch(() => "");
    const extension = subsOnly ? (suggested.split(".").pop() ?? "srt") : "mkv";
    const output = await save({
      defaultPath: suggested || undefined,
      filters: [subsOnly ? { name: "Sous-titres", extensions: [extension] } : { name: "Vidéo MKV", extensions: ["mkv"] }],
    });
    if (!output) return;
    if (output.toLowerCase() === analysis.reference.path.toLowerCase()) {
      setRun({ status: "error", log: [], error: "Choisis un autre nom que le fichier d'origine : il ne peut pas être remplacé pendant sa lecture." });
      return;
    }
    setCancelling(false);
    setRun({ status: "running", log: [] });
    try {
      const result = await runJob<RenderResult>(
        startRender(analysis.reference, analysis.target, analysis.segments, {
          output,
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
  const summary = subsOnly
    ? "Contiendra les sous-titres corrigés, seuls (SRT/ASS)."
    : sameFile
      ? "Contiendra la vidéo, où la piste corrigée remplace l'originale. Rien n'est réencodé, le fichier d'origine n'est pas modifié."
      : "Contiendra la vidéo, avec les sous-titres corrigés en piste supplémentaire. Rien n'est réencodé, le fichier d'origine n'est pas modifié.";

  return (
    <section className="panel field-results">
      <h2>Export</h2>
      <div className="export-options">
        <PillSwitch
          className="pill-switch-wide"
          label="Contenu de l'export"
          options={referenceIsVideo ? EXPORT_KINDS : EXPORT_KINDS.slice(1)}
          value={subsOnly ? "subs" : "mkv"}
          onChange={(v) => setSubsOnly(v === "subs")}
          disabled={running}
        />
        {!subsOnly && !sameFile && (
          <div className="export-fields">
            <label>
              Langue :
              <select value={language} onChange={(e) => setLanguage(e.target.value)} disabled={running}>
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
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="ex. Français" disabled={running} />
            </label>
            <label className="export-check">
              <input type="checkbox" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} disabled={running} />
              Piste par défaut
            </label>
          </div>
        )}
      </div>

      <div className="export-box">
        <p className="export-summary">
          Contenu de l'export <InfoTip>{summary}</InfoTip>
        </p>
        <LogPanel lines={run.log} />
        {run.status === "error" && <p className="error">{run.error}</p>}
        {run.status === "done" && run.result && (
          <div className="export-written">
            <span className="render-success" title={run.result.path}>
              Fichier écrit : {fileName(run.result.path)}
            </span>
            <button className="small-button" onClick={() => revealItemInDir(run.result!.path)}>
              Ouvrir le dossier
            </button>
          </div>
        )}
        {run.status === "done" && run.result && run.result.dropped.length > 0 && (
          <LogPanel
            title={`${run.result.dropped.length} réplique${run.result.dropped.length > 1 ? "s" : ""} retirée${run.result.dropped.length > 1 ? "s" : ""}`}
            lines={run.result.dropped.map((d) => `${clock(d.start)} · ${d.text}`)}
          />
        )}
        {run.status === "cancelled" && <p className="export-cancelled">Export annulé : aucun fichier n'a été écrit.</p>}
        {running ? (
          <div className="export-running">
            <span className="export-running-label">Export en cours...</span>
            <button
              className="export-cancel"
              onClick={() => {
                setCancelling(true);
                cancelJob(run.jobId!);
              }}
              disabled={!run.jobId || cancelling}
            >
              {cancelling ? "Annulation..." : "Annuler l'export"}
            </button>
          </div>
        ) : (
          <button className="primary-button export-button" onClick={exportFile}>
            Exporter le fichier synchronisé
          </button>
        )}
      </div>
    </section>
  );
}
