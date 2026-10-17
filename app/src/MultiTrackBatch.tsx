import { useEffect, useMemo, useState } from "react";
import { probe, startAnalyze, startRenderTracks, type Analysis, type CueEdits, type Segment, type TrackInfo, type TrackRef } from "./api";
import { runJob } from "./jobs";
import {
  awaitsCues,
  defaultPick,
  resolveTracks,
  trackOptions,
  TrackFilterPicker,
  readable,
  correctable,
  type Resolution,
  type TrackChoice,
  type TrackKey,
} from "./TrackFilter";
import {
  AnalyzeButton,
  BatchFooter,
  nextStep,
  IDLE_EXPORT,
  rowState,
  useExportQueue,
  dropBlockedReason,
  type AnalysisRun,
  type ExportFields,
} from "./batchShared";
import { InfoTip } from "./InfoTip";
import {
  EmptyWorkspace,
  trackName,
  Issues,
  ListRow,
  FoldButton,
  ModeCards,
  RemoveAllButton,
  useListKeys,
  MoveButtons,
  runBadge,
  useProbes,
  type BadgeKind,
  type BatchMode,
} from "./Workspace";
import { DetailChart, DetailExport, DetailHeader, DetailTabs, TracksHeading, useDetailView } from "./Detail";
import AnalysisView, { AnalysisSummary, analysisDuration, chartCues } from "./AnalysisView";
import { DropZone } from "./DropZone";
import { DropOverlay, useFileDrop } from "./FileDrop";
import { basename } from "./paths";
import { SegmentEditor } from "./SegmentEditor";
import { renderEdits, withSegments } from "./retime";
import { clock, isSubtitleFile, SUBTITLE_EXTENSIONS, VIDEO_EXTENSIONS } from "./format";
import { LOW_CONFIDENCE, pickFiles } from "./shared";
import { Select } from "./Dropdown";
import { TrackTable, type ExternalTrack } from "./TrackTable";
import { useCueView } from "./CueLoupe";
import { SegmentChart } from "./SegmentChart";
import { devParam, errorMessage, toggled } from "./util";
import { useT } from "./i18n";
import { languageCode } from "./languages";
import { WarningIcon } from "./icons";
import { CLEAN_KINDS, useCleanKinds, useCleanSubtitles, useListCollapsed, useSubsOnly } from "./settings";
import { useCleanupView } from "./useCleanupView";
import { CleanupPicker, DEFAULT_TRACK_OPTIONS, flagValue } from "./exportOptions";

/** One file's analyses (one per corrected track) and its single export. Kept
 * with the reference they were made against: a different one since makes
 * them stale. */
interface FileRun extends ExportFields {
  referenceIndex: number;
  targets: Record<string, AnalysisRun>;
}

/** A track a file has to correct: one of its own (by index), or a
 * standalone subtitle file added to it ("+ Ajouter des sous-titres"). Its
 * `id` keys its analysis and its tab. */
interface Target {
  id: string;
  ref: TrackRef;
  label: string;
  track?: TrackInfo;
  /** A standalone file: the video's track it takes the place of (null: added). */
  replaces?: number | null;
}

/** The video's track a standalone file takes the place of on export: the
 * one picked, or by default the first full one in its language that isn't
 * corrected itself (`taken`), else none (it's added). */
function replacedTrack(ext: ExternalTrack, tracks: TrackInfo[], taken: number[]): number | null {
  if (ext.replaces !== undefined) return ext.replaces;
  const language = languageCode(ext.language);
  return tracks.find((tr) => language && languageCode(tr.language) === language && !tr.forced && !taken.includes(tr.index))?.index ?? null;
}

/** Whether an analysis found something worth a look: an unreliable
 * segment, a warning, lines that fall off. */
const weak = (a: Analysis) =>
  a.segments.some((s) => s.confidence < LOW_CONFIDENCE) || a.warnings.length > 0 || a.target_cues.some((c) => c.corrected === null);

/** "Fichiers multipistes": one file or a series of files that each hold
 * both the reference and the track(s) to correct. Tracks are picked for
 * every file (by number, language or name, see TrackFilter), which survives
 * a track order that changes from one episode to the next; a file where
 * that's off is flagged, and its tracks can be ticked by hand in its
 * detail, where a standalone subtitle file can be added to correct too.
 * Each file's export holds all its corrected tracks. From Bobine Audio. */
export function MultiTrackBatch({
  hidden,
  onModeChange,
  outputDir,
  onOutputDirChange,
  blocked,
  onBusyChange,
}: {
  hidden: boolean;
  /** Switches to pairs mode, from the empty workspace's cards. */
  onModeChange?: (mode: BatchMode) => void;
  outputDir: string | null;
  onOutputDirChange: (dir: string | null) => void;
  /** The other batch mode is working: nothing starts here meanwhile. */
  blocked: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const m = useT();
  const [files, setFiles] = useState<string[]>([]);
  // What the top bar picks in every file (see TrackFilter): the reference,
  // and the tracks to correct (any track one of these names).
  const [referenceKey, setReferenceKey] = useState<TrackKey>("");
  const [targetKeys, setTargetKeys] = useState<TrackKey[]>([]);
  const [choices, setChoices] = useState<Record<string, TrackChoice>>({});
  // Standalone subtitle files added to a file's tracks to correct.
  const [externals, setExternals] = useState<Record<string, ExternalTrack[]>>({});
  // What an export writes, as the export options say (both modes alike);
  // the corrected tracks' name and flags.
  const subsOnly = useSubsOnly();
  const [batchTrack, setBatchTrack] = useState(DEFAULT_TRACK_OPTIONS);
  const [runs, setRuns] = useState<Record<string, FileRun>>({});
  const [analyzing, setAnalyzing] = useState(false);
  const queue = useExportQueue(outputDir, subsOnly);
  const [editing, setEditing] = useState<{ path: string; target: string } | null>(null);
  // The file shown in the detail, and which of each file's corrected tracks
  // its tabs show (absent: its first).
  const [selected, setSelected] = useState<string | null>(null);
  const [shownTargets, setShownTargets] = useState<Record<string, string>>({});
  const collapsed = useListCollapsed();
  // Segments / Loupe, when the detail is too low for both.
  const view = useDetailView();
  const cleanSubtitles = useCleanSubtitles();
  const cleanKinds = useCleanKinds();
  const busy = analyzing || queue.exporting;
  useEffect(() => onBusyChange(busy), [busy, onBusyChange]);

  /** Adds videos not in the list yet (checked against the list as it really
   * is, not a possibly stale copy: adding the same files twice in a row
   * must not list them twice). */
  function addPaths(paths: string[]) {
    const videos = paths.filter((p) => !isSubtitleFile(p));
    setFiles((current) => [...current, ...[...new Set(videos)].filter((p) => !current.includes(p))]);
  }

  async function pickVideos() {
    addPaths(await pickFiles(m.files.addVideos, { name: m.files.videosFilter, extensions: VIDEO_EXTENSIONS }, "references"));
  }

  const dropBlocked = dropBlockedReason(busy, blocked);
  const fileDrag = useFileDrop(!hidden && editing === null, dropBlocked, addPaths);

  // Each file's tracks are read once, as soon as it's listed.
  const probes = useProbes(files);

  // A file is always shown while the list has some: the first one listed,
  // or the next one up when the shown one is removed.
  useEffect(() => {
    if (selected !== null && files.includes(selected)) return;
    setSelected(files[0] ?? null);
  }, [files, selected]);

  useListKeys(!hidden, files.length, selected === null ? -1 : files.indexOf(selected), (i) => setSelected(files[i]));

  // Dev only (see devParam): `?batchFiles=a|b` adds files.
  useEffect(() => {
    const list = devParam("batchFiles");
    if (list) addPaths(list.split("|"));
  }, []);

  // Dev only: automated UI checks add files without the native dialog.
  useEffect(() => {
    if (!import.meta.env.DEV || hidden) return;
    (window as unknown as { __test?: object }).__test = { addFiles: addPaths, addSubtitles: addExternalPaths };
  });

  // The picks start out from the first probed file (see defaultPick). Only
  // while none is set, so a pick of the user's is never overridden.
  const firstTracks = files.map((f) => probes[f]?.tracks).find((t) => t && t.length > 0);
  useEffect(() => {
    if (referenceKey || !firstTracks) return;
    const pick = defaultPick(firstTracks);
    setReferenceKey(pick.reference);
    setTargetKeys(pick.targets);
  }, [firstTracks, referenceKey]);

  const probed = files.flatMap((f) => (probes[f]?.tracks ? [probes[f].tracks!] : []));
  const referenceOptions = trackOptions(probed.map((tracks) => tracks.filter(readable)));
  const targetOptions = trackOptions(probed.map((tracks) => tracks.filter(correctable)));
  const resolutions: Record<string, Resolution | null> = Object.fromEntries(
    files.map((f) => {
      const p = probes[f];
      // Its reference not picked until its tracks' line counts decide it.
      const ready = p?.tracks && !awaitsCues(p.tracks, p.cues, referenceKey, targetKeys, choices[f]);
      return [f, ready ? resolveTracks(p.tracks!, p.cues, referenceKey, targetKeys, choices[f]) : null];
    }),
  );

  /** A file's tracks to correct: its own as picked, then the standalone
   * files ticked for it. */
  function targetsOf(path: string): Target[] {
    const own = (resolutions[path]?.targets ?? []).map((tr) => ({
      id: `@${tr.index}`,
      ref: { path, index: tr.index },
      label: trackName(tr.index, tr),
      track: tr,
    }));
    const taken = own.map((t) => t.track.index);
    const tracks = probes[path]?.tracks ?? [];
    const added = (externals[path] ?? [])
      .filter((e) => e.checked)
      .map((e) => {
        const replaces = replacedTrack(e, tracks, taken);
        if (replaces !== null) taken.push(replaces);
        return { id: e.path, ref: { path: e.path, index: null }, label: basename(e.path), replaces };
      });
    return [...own, ...added];
  }

  /** This file's analyses, if made against its current reference. */
  function runOf(path: string): FileRun | null {
    const run = runs[path];
    const reference = resolutions[path]?.reference;
    return run && reference && run.referenceIndex === reference.index ? run : null;
  }

  function updateRun(path: string, update: (run: FileRun) => FileRun) {
    setRuns((current) => (current[path] ? { ...current, [path]: update(current[path]) } : current));
  }

  function updateTarget(path: string, id: string, patch: Partial<AnalysisRun> | ((t: AnalysisRun) => Partial<AnalysisRun>)) {
    updateRun(path, (run) => {
      const target = run.targets[id];
      const next = typeof patch === "function" ? patch(target) : patch;
      return { ...run, targets: { ...run.targets, [id]: { ...target, ...next } } };
    });
  }

  /** A file's tracks to correct (as picked now) whose analysis against its
   * current reference succeeded -- what its export holds. */
  function doneTargets(path: string): [Target, AnalysisRun][] {
    const run = runOf(path);
    if (!run) return [];
    return targetsOf(path).flatMap((target) => {
      const r = run.targets[target.id];
      return r?.status === "done" && r.result ? [[target, r] as [Target, AnalysisRun]] : [];
    });
  }

  /** Analyzes the tracks to correct that aren't yet (new files, new
   * languages, failed ones), keeping the rest and any edit made to them; or
   * all of them again (`all`); of every file, or of `only` (the detail's
   * "Analyser"). */
  async function handleAnalyze(all: boolean, only?: string) {
    await runPlan(
      files.flatMap((path) => {
        if (only !== undefined && path !== only) return [];
        const reference = resolutions[path]?.reference;
        const targets = targetsOf(path);
        if (!reference || targets.length === 0) return [];
        const run = runOf(path);
        const todo = all ? targets : targets.filter((t) => run?.targets[t.id]?.status !== "done");
        return todo.length > 0 ? [{ path, reference, targets: todo, keep: all ? null : run }] : [];
      }),
    );
  }

  /** "Réanalyser" on one corrected track of a file: that one alone again
   * (its edits are lost), the file's others kept. */
  function reanalyzeTarget(path: string, target: Target) {
    const reference = resolutions[path]?.reference;
    if (reference) runPlan([{ path, reference, targets: [target], keep: runOf(path) }]);
  }

  async function runPlan(plan: { path: string; reference: TrackInfo; targets: Target[]; keep: FileRun | null }[]) {
    setAnalyzing(true);
    setRuns((current) => {
      const next = { ...current };
      for (const { path, reference, targets, keep } of plan) {
        next[path] = {
          referenceIndex: reference.index,
          targets: {
            ...keep?.targets,
            ...Object.fromEntries(
              targets.map((t) => [t.id, { status: "pending", result: null, error: null, log: [] } satisfies AnalysisRun]),
            ),
          },
          // What it held changes: the last export no longer matches.
          ...IDLE_EXPORT,
        };
      }
      return next;
    });
    for (const { path, reference, targets } of plan) {
      for (const target of targets) {
        updateTarget(path, target.id, { status: "running" });
        try {
          const result = await runJob<Analysis>(startAnalyze({ path, index: reference.index }, target.ref), (message) =>
            updateTarget(path, target.id, (t) => ({ log: [...t.log, message] })),
          );
          updateTarget(path, target.id, { status: "done", result, edited: false });
        } catch (err) {
          updateTarget(path, target.id, { status: "error", error: errorMessage(err) });
        }
      }
    }
    setAnalyzing(false);
  }

  /** One export per file, holding every corrected track whose analysis
   * succeeded, with its segments as edited ("Modifier"): one new MKV, or
   * one subtitle file each; of every file, or of `only` ("Exporter ce
   * fichier"). */
  function handleExport(only?: string) {
    queue.run(
      files
        .filter((path) => (only === undefined || path === only) && doneTargets(path).length > 0)
        .map((path) => {
          const reference: TrackRef = { path, index: runOf(path)!.referenceIndex };
          const done = doneTargets(path);
          return {
            items: (subsOnly ? done : done.slice(0, 1)).map(([target]) => [reference, target.ref] as [TrackRef, TrackRef]),
            start: (outputs: string[]) =>
              startRenderTracks(
                reference,
                done.map(([target, r], k) => ({
                  target: target.ref,
                  segments: r.result!.segments,
                  ...renderEdits(r.result!.edits),
                  output: subsOnly ? outputs[k] : null,
                  replaces: target.replaces ?? null,
                  title: batchTrack.title || null,
                  default: flagValue(batchTrack.isDefault),
                  forced: flagValue(batchTrack.forced),
                })),
                {
                  output: subsOnly ? null : outputs[0],
                  subsOnly,
                  clean: cleanSubtitles,
                  cleanKinds: cleanKinds.length === CLEAN_KINDS.length ? null : cleanKinds,
                },
              ),
            update: (patch: (entry: ExportFields) => Partial<ExportFields>) => updateRun(path, (r) => ({ ...r, ...patch(r) })),
          };
        }),
    );
  }

  /** "+ Ajouter des sous-titres": standalone files to correct, added to
   * `path`'s tracks (ticked), each read for its line count. */
  async function addExternal(path: string) {
    addExternalPaths(
      path,
      await pickFiles(m.files.addSubtitles, { name: m.files.subtitlesFilter, extensions: SUBTITLE_EXTENSIONS }, "targets"),
    );
  }

  function addExternalPaths(path: string, picked: string[]) {
    const fresh = picked.filter((p) => !(externals[path] ?? []).some((e) => e.path === p));
    if (fresh.length === 0) return;
    const added: ExternalTrack[] = fresh.map((p) => ({
      path: p,
      format: p.split(".").pop()?.toLowerCase() ?? null,
      cues: null,
      checked: true,
      language: null,
    }));
    setExternals((c) => ({ ...c, [path]: [...(c[path] ?? []), ...added] }));
    for (const ext of added) {
      probe(ext.path)
        .then((res) => {
          setExternals((c) => ({
            ...c,
            [path]: (c[path] ?? []).map((e) => (e.path === ext.path ? { ...e, cues: res.cue_count, language: res.language ?? null } : e)),
          }));
          untickSameLanguage(path, languageCode(res.language));
        })
        .catch(() => {});
    }
  }

  /** A standalone file in `language` added to `path`: its own track in that
   * language is no longer corrected itself -- the file takes its place on
   * export (see replacedTrack); it can be ticked again. */
  function untickSameLanguage(path: string, language: string | null) {
    const same = (resolutions[path]?.targets ?? [])
      .filter((tr) => language && languageCode(tr.language) === language && !tr.forced)
      .map((tr) => tr.index);
    if (same.length > 0) editChoice(path, (c) => ({ ...c, targets: c.targets.filter((i) => !same.includes(i)) }));
  }

  // Counted over the tracks to correct as picked now, analyzed or not.
  const allTargets = files.flatMap((f) => (resolutions[f]?.reference ? targetsOf(f).map((t) => runOf(f)?.targets[t.id]) : []));
  const analyzedCount = allTargets.filter((t) => t?.status === "done").length;
  // Tracks "Analyser" would do: not analyzed yet, or failed.
  const missingCount = files.reduce((n, f) => (resolutions[f]?.reference ? n + targetsOf(f).length - doneTargets(f).length : n), 0);
  const exportedCount = files.filter((f) => runOf(f)?.exportStatus === "done").length;
  const flaggedCount = files.filter((f) => (resolutions[f]?.issues.length ?? 0) > 0 || probes[f]?.error).length;
  const analyzable = files.some((f) => resolutions[f]?.reference && targetsOf(f).length > 0);
  // The window's next step: the footer's with several files, the detail's
  // with one.
  const listNext =
    files.length > 1
      ? nextStep({
          analyzing,
          missing: missingCount,
          exportable: files.filter((f) => doneTargets(f).length > 0).length,
          exported: exportedCount,
        })
      : null;

  const editingRun = editing ? runOf(editing.path)?.targets[editing.target] : null;

  /** A corrected track's segments and lines kept or taken out, changed by
   * hand: its export is to do again. */
  /** A file's analyses checked by hand ("Valider"), or no longer. */
  function setValidated(path: string, validated: boolean) {
    updateRun(path, (run) => ({
      ...run,
      targets: Object.fromEntries(
        Object.entries(run.targets).map(([id, t]) => [id, t.result ? { ...t, result: { ...t.result, validated } } : t]),
      ),
    }));
  }

  function saveEdits(path: string, target: string, segments: Segment[], edits: CueEdits) {
    updateTarget(path, target, (t) => ({ result: t.result ? withSegments(t.result, segments, edits) : t.result, edited: true }));
    updateRun(path, (r) => ({ ...r, ...IDLE_EXPORT }));
  }

  /** "file · @1 fre contre @0 eng": what the editor corrects. */
  function editorSubtitle(path: string, target: string): string {
    const index = runOf(path)?.referenceIndex;
    const reference = probes[path]?.tracks?.find((tr) => tr.index === index);
    const label = targetsOf(path).find((t) => t.id === target)?.label ?? target;
    return m.editor.subtitle(basename(path), label, index === undefined ? "?" : trackName(index, reference));
  }

  /** "Réf. auto @0 eng → @1 fre, extra.srt": a file's tracks as used now. */
  function tracksSummary(path: string, res: Resolution): string {
    const targets = targetsOf(path).map((t) => t.label);
    const reference = res.reference ? trackName(res.reference.index, res.reference) : "?";
    return `${res.auto ? `${m.multi.autoReference} ` : ""}${reference} → ${targets.length > 0 ? targets.join(", ") : m.multi.nothing}`;
  }

  /** A row's badge: what's running first, then what's wrong, then how far it got. */
  function rowBadge(path: string): [string, BadgeKind] {
    const s = m.multi.status;
    const probed = probes[path];
    const res = resolutions[path];
    if (!probed) return [s.reading, "idle"];
    if (probed.error || !res) return [s.unreadable, "error"];
    const run = runOf(path);
    const runsOfFile = res.reference ? targetsOf(path).map((t) => run?.targets[t.id]) : [];
    const statuses = runsOfFile.map((r) => r?.status);
    const badge = runBadge(statuses, run?.exportStatus, { ...s, analyzed: s.analyzed(statuses.length) });
    if (badge?.[1] === "analyzed" && runsOfFile.every((r) => r?.result?.validated)) return [s.validated, "analyzed"];
    if (badge?.[1] === "analyzed" && runsOfFile.some((r) => r?.result && weak(r.result))) return [s.check, "warning"];
    return badge ?? (res.issues.length > 0 || !res.reference || runsOfFile.length === 0 ? [s.check, "warning"] : [s.toAnalyze, "idle"]);
  }

  // The detail: the selected file, and the corrected track its tabs show.
  const detailPath = selected;
  const detailProbe = detailPath ? probes[detailPath] : undefined;
  const detailRes = detailPath ? resolutions[detailPath] : null;
  const detailRun = detailPath ? runOf(detailPath) : null;
  const detailTargets = detailPath ? targetsOf(detailPath) : [];
  const shownTarget = detailTargets.find((t) => t.id === shownTargets[detailPath!]) ?? detailTargets[0] ?? null;
  const shownRun = shownTarget ? detailRun?.targets[shownTarget.id] : undefined;
  const shownResult = shownRun?.status === "done" ? shownRun.result : null;
  // The file checked by hand, all its tracks, when one is to check (or it was).
  const detailResults =
    detailPath && detailRes?.reference
      ? targetsOf(detailPath).flatMap((t) => {
          const r = runOf(detailPath)?.targets[t.id];
          return r?.status === "done" && r.result ? [r.result] : [];
        })
      : [];
  const detailValidated = detailResults.length > 0 && detailResults.every((r) => r.validated);
  const detailValidation =
    detailPath && detailResults.length > 0 && (detailValidated || detailResults.some(weak))
      ? { validated: detailValidated, onToggle: () => setValidated(detailPath, !detailValidated) }
      : undefined;
  // As the export will clean it (see useCleanupView).
  const cleanedResult = useCleanupView(shownResult, cleanSubtitles, cleanKinds);
  const shownDuration = shownResult ? analysisDuration(shownResult, detailProbe?.duration ?? null) : 0;
  const shownCues = useMemo(() => shownResult && chartCues(shownResult), [shownResult]);
  // The loupe's stretch, framed on the chart.
  const [loupeView, setLoupeView] = useCueView(`${detailPath}|${shownTarget?.id}`, shownResult, shownDuration);
  const detailReference = detailRes?.reference ?? null;
  const detailDone = detailPath ? doneTargets(detailPath).length : 0;
  // Tracks its "Analyser" would do: not analyzed yet, or failed.
  const detailMissing = detailReference ? detailTargets.length - detailDone : 0;
  const detailAnalyzing = detailTargets.some((t) => {
    const status = detailRun?.targets[t.id]?.status;
    return status === "pending" || status === "running";
  });

  /** A change to a file's tracks in its detail: from then on they're its
   * own ("(manuel)"), starting from what the top bar picked. */
  function editChoice(path: string, update: (choice: TrackChoice) => TrackChoice) {
    const res = resolutions[path];
    const tracks = probes[path]?.tracks;
    if (!res || !tracks || tracks.length === 0) return;
    setChoices((c) => ({
      ...c,
      [path]: update(c[path] ?? { reference: res.reference?.index ?? tracks[0].index, targets: res.targets.map((t) => t.index) }),
    }));
  }

  return (
    <main className="batch-main" style={hidden ? { display: "none" } : undefined}>
      {files.length === 0 ? (
        <EmptyWorkspace title={m.multi.emptyTitle} hint={m.multi.emptyHint}>
          <DropZone title={m.files.dropZoneMany} disabled={dropBlocked !== null} onClick={pickVideos}>
            {m.multi.empty}
          </DropZone>
          <ModeCards mode="multi" onChange={onModeChange} />
        </EmptyWorkspace>
      ) : (
        <>
          <div className="batch-config panel">
            <span className="config-field">
              {m.common.labelled(m.multi.reference)}
              <TrackFilterPicker
                label={m.common.reference}
                options={referenceOptions}
                value={referenceKey ? [referenceKey] : []}
                onChange={([key]) => setReferenceKey(key)}
                single
                disabled={busy}
              />
            </span>
            <span className="config-field">
              {m.common.labelled(m.multi.toCorrect)}
              <TrackFilterPicker
                label={m.common.toCorrect}
                options={targetOptions}
                value={targetKeys}
                onChange={setTargetKeys}
                disabled={busy}
              />
            </span>
            <CleanupPicker disabled={busy} />
            <InfoTip>{m.multi.hint}</InfoTip>
          </div>

          <div className={`workspace${collapsed ? " list-collapsed" : ""}`}>
            <section className="panel file-list">
              <div className="file-list-header">
                <h2>{m.multi.filesCount(files.length)}</h2>
                <RemoveAllButton
                  results={Object.values(runs).some((run) => Object.values(run.targets).some((t) => t.status === "done"))}
                  disabled={busy}
                  onRemove={() => {
                    setFiles([]);
                    setChoices({});
                    setExternals({});
                    setRuns({});
                    setShownTargets({});
                    // Picked again from the next files added.
                    setReferenceKey("");
                    setTargetKeys([]);
                  }}
                />
                <FoldButton collapsed={collapsed} />
              </div>

              <ul className="file-list-rows list-scroll">
                {files.map((path, i) => {
                  const probed = probes[path];
                  const res = resolutions[path];
                  const run = runOf(path);
                  const [badge, badgeKind] = rowBadge(path);
                  return (
                    <ListRow
                      key={path}
                      name={basename(path)}
                      path={path}
                      selected={path === selected}
                      onSelect={() => setSelected(path)}
                      state={rowState(
                        res?.reference ? targetsOf(path).map((t) => run?.targets[t.id]) : [],
                        run?.exportStatus,
                        !!(res?.issues.length || probed?.error),
                      )}
                      badge={badge}
                      badgeKind={badgeKind}
                      detail={
                        <>
                          {!probed && m.batch.readingTracks}
                          {probed?.error && <span className="error">{probed.error}</span>}
                          {res && tracksSummary(path, res)}
                          {res?.manual && <span className="list-row-manual">{m.multi.manual}</span>}
                          {res && res.issues.length > 0 && <Issues issues={res.issues} />}
                        </>
                      }
                      actions={<MoveButtons count={files.length} index={i} disabled={busy} onChange={(update) => setFiles(update)} />}
                    />
                  );
                })}
              </ul>
              {/* Adding more: a click picks files, or they're dropped on the window. */}
              <button className="file-list-add" disabled={busy} title={m.multi.addHint} onClick={pickVideos}>
                <span>{m.multi.addMore}</span>
                <span>{m.multi.dropMore}</span>
              </button>
            </section>

            {detailPath && (
              <section className="panel file-detail">
                <DetailHeader
                  title={basename(detailPath)}
                  titleTooltip={detailPath}
                  meta={
                    detailProbe?.tracks
                      ? m.multi.meta(detailProbe.duration ? clock(detailProbe.duration, 0) : null, detailProbe.tracks.length)
                      : !detailProbe?.error && m.batch.readingTracks
                  }
                  onReanalyze={
                    shownTarget && (shownRun?.status === "done" || shownRun?.status === "error")
                      ? () => reanalyzeTarget(detailPath, shownTarget)
                      : undefined
                  }
                  onEdit={shownTarget && shownResult ? () => setEditing({ path: detailPath, target: shownTarget.id }) : undefined}
                  editDisabled={queue.exporting}
                  missing={detailMissing}
                  analyzing={detailAnalyzing}
                  done={detailDone}
                  exported={detailRun?.exportStatus === "done"}
                  primary={files.length === 1}
                  disabled={busy || blocked}
                  analyzeDisabled={!detailReference}
                  blockedTitle={blocked ? m.batch.otherModeBusy : undefined}
                  analyzeTitle={m.multi.analyzeFileHint}
                  exportLabel={m.multi.exportFile}
                  onAnalyze={() => handleAnalyze(false, detailPath)}
                  validation={detailValidation}
                  onExport={() => handleExport(detailPath)}
                />

                {detailProbe?.error && <p className="error">{detailProbe.error}</p>}
                {detailRes && detailProbe?.tracks && (
                  <div className="detail-body" ref={view.ref}>
                    {shownTarget && (
                      <DetailTabs
                        tracks={detailTargets.map((t) => [t.id, t.label] as const)}
                        value={shownTarget.id}
                        onChange={(id) => setShownTargets((c) => ({ ...c, [detailPath]: id }))}
                        view={view.compact && shownResult ? { value: view.view, onChange: view.setView } : undefined}
                      />
                    )}

                    <div className={view.topClass(!!shownResult)}>
                      <div className="detail-tracks">
                        <TracksHeading
                          hint={m.multi.tracksHint}
                          reset={
                            detailRes.manual
                              ? {
                                  label: m.multi.byLanguage,
                                  title: m.multi.byLanguageHint,
                                  disabled: busy,
                                  onClick: () =>
                                    setChoices((c) => {
                                      const next = { ...c };
                                      delete next[detailPath];
                                      return next;
                                    }),
                                }
                              : undefined
                          }
                        />
                        <div className="tracks-table-wrap list-scroll detail-tracks-table">
                          <TrackTable
                            className="batch-tracks-table"
                            tracks={detailProbe.tracks}
                            cues={detailProbe.cues}
                            externals={externals[detailPath]}
                            radioName={`reference-${detailPath}`}
                            reference={detailReference?.index ?? null}
                            targets={detailRes.targets.map((t) => t.index)}
                            disabled={busy}
                            onReference={(index) =>
                              editChoice(detailPath, (c) => ({ ...c, reference: index, targets: c.targets.filter((i) => i !== index) }))
                            }
                            onToggleTarget={(index) => editChoice(detailPath, (c) => ({ ...c, targets: toggled(c.targets, index) }))}
                            onToggleExternal={(ext) =>
                              setExternals((c) => ({
                                ...c,
                                [detailPath]: (c[detailPath] ?? []).map((e) => (e.path === ext ? { ...e, checked: !e.checked } : e)),
                              }))
                            }
                          />
                        </div>
                        <div className="detail-add-subs">
                          <button className="small-button" disabled={busy} onClick={() => addExternal(detailPath)}>
                            {m.multi.addSubtitles}
                          </button>
                          <span className="detail-add-subs-hint">{m.multi.addSubtitlesHint}</span>
                        </div>
                        {detailRes.issues.length > 0 && <Issues issues={detailRes.issues} />}
                        {!subsOnly &&
                          detailTargets.map((t) =>
                            t.track ? (
                              <span key={t.id} className="detail-export-note">
                                {m.multi.exportReplaces(t.label)}
                              </span>
                            ) : (
                              <span key={t.id} className="detail-export-note detail-export-choice">
                                {m.common.labelled(t.label)}
                                <Select
                                  label={m.multi.exportOf(t.label)}
                                  value={t.replaces === null || t.replaces === undefined ? "add" : String(t.replaces)}
                                  options={[
                                    ...(detailProbe.tracks ?? [])
                                      .filter(
                                        (tr) =>
                                          tr.index === t.replaces ||
                                          !detailTargets.some((o) => o !== t && (o.track?.index ?? o.replaces) === tr.index),
                                      )
                                      .map((tr) => ({
                                        value: String(tr.index),
                                        label: m.multi.exportReplacesTrack(trackName(tr.index, tr)),
                                      })),
                                    { value: "add", label: m.multi.exportAdded },
                                  ]}
                                  onChange={(v) =>
                                    setExternals((c) => ({
                                      ...c,
                                      [detailPath]: (c[detailPath] ?? []).map((e) =>
                                        e.path === t.id ? { ...e, replaces: v === "add" ? null : Number(v) } : e,
                                      ),
                                    }))
                                  }
                                  disabled={busy}
                                />
                              </span>
                            ),
                          )}
                      </div>

                      <DetailChart
                        summary={
                          <>
                            {detailReference && shownTarget && m.multi.againstReference(trackName(detailReference.index, detailReference))}
                            {shownRun?.edited && m.multi.edited}
                          </>
                        }
                        run={shownRun}
                        noTrack={detailTargets.length === 0 ? m.multi.noTarget : null}
                      >
                        {shownResult && (
                          <div className="detail-summary">
                            <AnalysisSummary
                              analysis={cleanedResult ?? shownResult}
                              edited={shownRun?.edited}
                              cleanup={cleanSubtitles}
                              onEdits={
                                queue.exporting ? undefined : (edits) => saveEdits(detailPath, shownTarget!.id, shownResult.segments, edits)
                              }
                            />
                            <SegmentChart
                              segments={shownResult.segments}
                              duration={shownDuration}
                              cues={shownCues ?? undefined}
                              view={loupeView}
                              onPick={(time) =>
                                setLoupeView({
                                  start: Math.max(0, Math.min(time - loupeView.duration / 2, shownDuration - loupeView.duration)),
                                  duration: loupeView.duration,
                                })
                              }
                            />
                          </div>
                        )}
                      </DetailChart>
                    </div>

                    {shownResult && (
                      <div className={view.loupeClass()}>
                        <AnalysisView
                          analysis={cleanedResult ?? shownResult}
                          duration={shownDuration}
                          view={loupeView}
                          onView={setLoupeView}
                        />
                      </div>
                    )}
                  </div>
                )}

                <DetailExport entry={detailRun} />
              </section>
            )}
          </div>

          <BatchFooter
            track={{ ...batchTrack, onChange: (patch) => setBatchTrack((c) => ({ ...c, ...patch })) }}
            outputDir={outputDir}
            onOutputDirChange={onOutputDirChange}
            busy={busy}
            blocked={blocked}
            progress={
              <>
                {m.multi.progressFiles(files.length)}
                {m.multi.progressAnalyzed(analyzedCount, allTargets.length)}
                {exportedCount > 0 && m.multi.progressExported(exportedCount)}
                {flaggedCount > 0 && (
                  <>
                    {" · "}
                    <WarningIcon /> {m.multi.progressFlagged(flaggedCount)}
                  </>
                )}
              </>
            }
            analyzeButton={
              <AnalyzeButton
                analyzing={analyzing}
                reading={files.some((f) => !probes[f] || (probes[f].tracks && !resolutions[f]))}
                missing={missingCount}
                analyzed={analyzedCount}
                unit="track"
                primary={listNext === "analyze"}
                disabled={!analyzable || busy || blocked}
                blocked={blocked}
                onAnalyze={(all) => handleAnalyze(all)}
              />
            }
            queue={queue}
            canExport={analyzedCount > 0}
            exportNext={listNext === "export"}
            onExport={() => handleExport()}
          />
        </>
      )}

      {editing && editingRun?.result && (
        <SegmentEditor
          analysis={editingRun.result}
          duration={analysisDuration(editingRun.result, probes[editing.path]?.duration ?? null)}
          subtitle={editorSubtitle(editing.path, editing.target)}
          onClose={() => setEditing(null)}
          onSave={(segments, edits) => {
            saveEdits(editing.path, editing.target, segments, edits);
            setEditing(null);
          }}
        />
      )}
      <DropOverlay drag={fileDrag} blocked={dropBlocked} label={m.files.dropToAdd} hint={m.files.folderHint} />
    </main>
  );
}
