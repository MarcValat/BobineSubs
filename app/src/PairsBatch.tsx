import { useEffect, useMemo, useRef, useState } from "react";
import {
  pairFiles,
  startAnalyze,
  startRenderTracks,
  type Analysis,
  type CueEdits,
  type FilePair,
  type Segment,
  type TrackInfo,
  type TrackRef,
} from "./api";
import { runJob } from "./jobs";
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
import { correctable, defaultPick, readable, resolveTracks, trackOptions, TrackFilterPicker, type TrackKey } from "./TrackFilter";
import {
  EmptyWorkspace,
  PairKind,
  trackName,
  Issues,
  FoldButton,
  ModeCards,
  RemoveAllButton,
  useListKeys,
  MoveButtons,
  PairRow,
  runBadge,
  useProbes,
  type BadgeKind,
  type BatchMode,
  type FileProbe,
} from "./Workspace";
import { DetailChart, DetailExport, DetailHeader, DetailTabs, TracksHeading, useDetailView } from "./Detail";
import AnalysisView, { AnalysisSummary, analysisDuration, chartCues } from "./AnalysisView";
import { DropZone } from "./DropZone";
import { DropOverlay, useFileDrop, type DropSide } from "./FileDrop";
import { basename } from "./paths";
import { SegmentEditor } from "./SegmentEditor";
import { withSegments } from "./retime";
import { isSubtitleFile, SUBTITLE_EXTENSIONS, VIDEO_EXTENSIONS } from "./format";
import { LOW_CONFIDENCE, pickFiles } from "./shared";
import { Select } from "./Dropdown";
import { useCueView } from "./CueLoupe";
import { SegmentChart } from "./SegmentChart";
import { devParam, errorMessage, FIELD_PROPS } from "./util";
import { useT } from "./i18n";
import { languageCode, languageLabel, LanguageSelect } from "./languages";
import { useCleanSubtitles, useListCollapsed, useSubsOnly } from "./settings";
import { DEFAULT_TRACK_OPTIONS, flagValue } from "./exportOptions";

/** One row of the list: a reference video and what to correct (a subtitle
 * file, or a video holding the track), as the engine paired them by
 * episode number -- or by hand, once swapped with ↑ ↓. Either can be
 * missing: a file without a pair yet. */
interface Pair {
  video: string | null;
  target: string | null;
  by: FilePair["by"] | "manual";
  episode: string | null;
}

/** A pair's tracks picked by hand in its detail, instead of the top bar's:
 * the reference video's track, and the track to correct of a video to
 * correct (null: a subtitle file, its only one). */
interface PairChoice {
  reference: number;
  target: number | null;
}

/** What a pair's export does, changed in its detail (absent: the top bar's). */
interface PairExport {
  language?: string;
  title?: string;
  /** The reference video's track it takes the place of; null: added. */
  replaces?: number | null;
}

/** A pair's tracks as used now: its reference, its track to correct, and
 * what was off when picking them. */
interface Resolved {
  reference: TrackInfo | null;
  target: TrackRef | null;
  /** The track to correct, when it's a video's. */
  targetTrack: TrackInfo | null;
  issues: string[];
  manual: boolean;
  auto: boolean;
}

/** Whether an analysis found something worth a look: an unreliable
 * segment, a warning, lines that fall off. */
const weak = (a: Analysis) =>
  a.segments.some((s) => s.confidence < LOW_CONFIDENCE) || a.warnings.length > 0 || a.target_cues.some((c) => c.corrected === null);

/** A pair's tracks table, both files' in one (from Bobine Audio): which
 * file each comes from, then the reference picked among the reference
 * video's tracks and the track to correct among the other's -- a subtitle
 * file being one row of its own, its only track. */
function PairTrackTable({
  referenceProbe,
  target,
  targetProbe,
  reference,
  targetTrack,
  disabled,
  onReference,
  onTarget,
}: {
  referenceProbe: FileProbe | undefined;
  target: string;
  targetProbe: FileProbe | undefined;
  reference: number | null;
  targetTrack: number | null;
  disabled: boolean;
  onReference: (index: number) => void;
  onTarget: (index: number) => void;
}) {
  const m = useT();
  const standalone = isSubtitleFile(target);
  const row = (side: "ref" | "cand", tr: TrackInfo, cues: Record<number, number> | null | undefined) => (
    <tr
      key={`${side}-${tr.index}`}
      title={
        [tr.title && m.tracks.titled(tr.title), side === "ref" && readable(tr) && !correctable(tr) && m.tracks.imageOnly]
          .filter(Boolean)
          .join(" · ") || undefined
      }
    >
      <td>
        <PairKind kind={side} />
      </td>
      <td>@{tr.index}</td>
      <td>{tr.language ?? "?"}</td>
      <td>
        {tr.codec}
        {tr.forced && ` · ${m.tracks.forced}`}
      </td>
      <td className="track-cues">{cues?.[tr.index] ?? "—"}</td>
      <td className="track-pick">
        {side === "ref" && (
          <input
            type="radio"
            aria-label={m.tracks.asReference(trackName(tr.index, tr))}
            name="pair-reference"
            checked={reference === tr.index}
            disabled={disabled || !readable(tr)}
            onChange={() => onReference(tr.index)}
          />
        )}
      </td>
      <td className="track-pick">
        {side === "cand" && (
          <input
            type="radio"
            aria-label={m.tracks.toCorrect(trackName(tr.index, tr))}
            name="pair-target"
            checked={targetTrack === tr.index}
            disabled={disabled || !correctable(tr)}
            onChange={() => onTarget(tr.index)}
          />
        )}
      </td>
    </tr>
  );
  return (
    <table className="batch-tracks-table">
      <thead>
        <tr>
          <th>{m.pairs.fileColumn}</th>
          <th>{m.tracks.track}</th>
          <th>{m.tracks.language}</th>
          <th>{m.tracks.format}</th>
          <th title={m.tracks.cuesHint}>{m.tracks.cues}</th>
          <th className="track-pick">{m.tracks.referenceShort}</th>
          <th className="track-pick">{m.tracks.toCorrectShort}</th>
        </tr>
      </thead>
      <tbody>
        {referenceProbe?.tracks?.map((tr) => row("ref", tr, referenceProbe.cues))}
        {standalone ? (
          <tr title={target}>
            <td>
              <PairKind kind="cand" />
            </td>
            <td className="track-external" colSpan={2}>
              {basename(target)}
            </td>
            <td>{target.split(".").pop()?.toLowerCase()}</td>
            <td className="track-cues">{targetProbe?.cueCount ?? "—"}</td>
            <td className="track-pick" />
            <td className="track-pick">
              <input type="radio" aria-label={m.tracks.toCorrect(basename(target))} checked readOnly disabled />
            </td>
          </tr>
        ) : (
          targetProbe?.tracks?.map((tr) => row("cand", tr, targetProbe.cues))
        )}
      </tbody>
    </table>
  );
}

/** "Paires de fichiers": a series' reference videos on one side, what to
 * correct on the other -- subtitle files (SRT, ASS), or videos holding the
 * track to correct -- paired by episode number (see the engine's
 * episodes.py; by order when the names have none in common, flagged).
 * Laid out as Bobine Audio's: the list of pairs (each file movable within
 * its own column: ↑ ↓ swap it with the next pair's) beside the selected
 * pair's detail -- its tracks, its export, its chart, the loupe and its
 * segments; the corrected track is added to the reference video, or takes
 * the place of its track in the same language (Remplacer / Garder). With
 * no file yet, two drop zones, one per column. Always kept mounted
 * (BatchView.tsx) even while the other mode is shown. */
export function PairsBatch({
  hidden,
  onModeChange,
  outputDir,
  onOutputDirChange,
  blocked,
  onBusyChange,
}: {
  hidden: boolean;
  /** Switches to multitrack mode, from the empty workspace's cards. */
  onModeChange?: (mode: BatchMode) => void;
  outputDir: string | null;
  onOutputDirChange: (dir: string | null) => void;
  /** The other batch mode is working: nothing starts here meanwhile. */
  blocked: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const m = useT();
  const [pairs, setPairs] = useState<Pair[]>([]);
  // The list as it really is, for files added while an earlier pairing is
  // still on its way.
  const latestPairs = useRef(pairs);
  latestPairs.current = pairs;
  // What the top bar picks for every pair (see TrackFilter): the reference
  // in each video, and the track to correct in a video to correct (the
  // first one these name); null: not picked yet.
  const [referenceKey, setReferenceKey] = useState<TrackKey>("");
  const [targetKeys, setTargetKeys] = useState<TrackKey[] | null>(null);
  // Pairs whose tracks or export were changed in their detail (by both files).
  const [choices, setChoices] = useState<Record<string, PairChoice>>({});
  const [pairExports, setPairExports] = useState<Record<string, PairExport>>({});
  // The added track, for every pair (the export options): "" its own
  // language, else this one; the video's track in its language replaced
  // (the default: it's often a poor one), or kept. Its name and flags.
  const [added, setAdded] = useState({ language: "", replaceSame: true });
  const { language: addedLanguage, replaceSame } = added;
  const [batchTrack, setBatchTrack] = useState(DEFAULT_TRACK_OPTIONS);
  const addedTitle = batchTrack.title;
  // What an export writes, as the export options say (both modes alike).
  const subsOnly = useSubsOnly();
  // Keyed by what each was made of (trackKey: both files and both tracks),
  // not by row: swapping files or adding more never shows a pair another
  // one's, and one that comes back finds its own again.
  const [analyses, setAnalyses] = useState<Record<string, AnalysisRun>>({});
  const [exports, setExports] = useState<Record<string, ExportFields>>({});
  const [analyzing, setAnalyzing] = useState(false);
  const queue = useExportQueue(outputDir, subsOnly);
  const [editing, setEditing] = useState<string | null>(null);
  // The row shown in the detail.
  const [selected, setSelected] = useState(0);
  const collapsed = useListCollapsed();
  // Segments / Loupe, when the detail is too low for both.
  const view = useDetailView();
  const cleanSubtitles = useCleanSubtitles();
  const busy = analyzing || queue.exporting;
  useEffect(() => onBusyChange(busy), [busy, onBusyChange]);

  // Every listed file, read once as soon as it's listed: a video's tracks,
  // a subtitle file's lines and language, or why it can't be read.
  const listed = useMemo(() => pairs.flatMap((p) => [p.video, p.target].filter((f): f is string => !!f)), [pairs]);
  const probes = useProbes(listed);

  /** Adds files, each to its column -- a subtitle file can only be
   * corrected, wherever it's dropped -- and pairs them all again by
   * episode number. */
  async function addFiles(files: string[], side: DropSide) {
    const videos = side === "left" ? files.filter((f) => !isSubtitleFile(f)) : [];
    await addPaths(videos, side === "left" ? files.filter(isSubtitleFile) : files);
  }

  async function addPaths(videos: string[], targets: string[]) {
    const current = latestPairs.current;
    const allVideos = [...new Set([...current.flatMap((p) => (p.video ? [p.video] : [])), ...videos])];
    const allTargets = [...new Set([...current.flatMap((p) => (p.target ? [p.target] : [])), ...targets])];
    try {
      const paired = await pairFiles(allVideos, allTargets);
      const next = paired.map((p) => ({ video: p.video, target: p.subtitle, by: p.by, episode: p.episode ?? null }));
      latestPairs.current = next;
      setPairs(next);
    } catch {
      // the engine is down: nothing could be done with them anyway
    }
  }

  const pickVideos = async () =>
    addFiles(await pickFiles(m.pairs.pickReferences, { name: m.files.videosFilter, extensions: VIDEO_EXTENSIONS }, "references"), "left");
  const pickTargets = async () =>
    addFiles(
      await pickFiles(
        m.pairs.pickCandidates,
        {
          name: m.pairs.candidatesFilter,
          extensions: [...SUBTITLE_EXTENSIONS, ...VIDEO_EXTENSIONS],
        },
        "targets",
      ),
      "right",
    );

  /** ↑ ↓ ✕ on one file of row `i` (`side`): moved within its column
   * (swapped with the neighbouring pair's, both then paired by hand), or
   * taken out of its row, which goes once it holds no file. */
  function changeColumn(i: number, side: "video" | "target", update: <T>(items: T[]) => T[]) {
    setPairs((current) => {
      const order = update(current.map((_, k) => k));
      if (order.length < current.length) {
        const left = { ...current[i], [side]: null, by: null, episode: null };
        return left.video || left.target ? current.map((p, k) => (k === i ? left : p)) : current.filter((_, k) => k !== i);
      }
      return current.map((p, k) => (order[k] === k ? p : { ...p, [side]: current[order[k]][side], by: "manual" as const, episode: null }));
    });
  }

  const dropBlocked = dropBlockedReason(busy, blocked);
  const fileDrag = useFileDrop(!hidden && editing === null, dropBlocked, addFiles);

  const rowCount = pairs.length;
  useListKeys(!hidden, rowCount, selected, setSelected);
  // The detail always shows a row while there are some.
  useEffect(() => {
    if (selected >= rowCount) setSelected(Math.max(0, rowCount - 1));
  }, [selected, rowCount]);

  // Dev only (see devParam): `?pairRefs=a|b&pairTargets=c|d` fills the lists.
  useEffect(() => {
    const refs = devParam("pairRefs");
    const targets = devParam("pairTargets");
    if (refs || targets) addPaths(refs?.split("|") ?? [], targets?.split("|") ?? []);
  }, []);

  // Dev only: automated UI checks add files without the native dialog.
  useEffect(() => {
    if (!import.meta.env.DEV || hidden) return;
    (window as unknown as { __test?: object }).__test = { addFiles };
  });

  // The picks start out from the first files read (see defaultPick). Only
  // while none is set, so a pick of the user's is never overridden.
  const firstReference = pairs.map((p) => p.video && probes[p.video]?.tracks).find((t) => t && t.length > 0);
  const firstTargetVideo = pairs
    .map((p) => p.target && !isSubtitleFile(p.target) && probes[p.target]?.tracks)
    .find((t) => t && t.length > 0);
  useEffect(() => {
    if (!referenceKey && firstReference) setReferenceKey(defaultPick(firstReference).reference);
  }, [firstReference, referenceKey]);
  useEffect(() => {
    if (targetKeys === null && firstTargetVideo) setTargetKeys(defaultPick(firstTargetVideo).targets);
  }, [firstTargetVideo, targetKeys]);

  /** Row `i`'s files, which its own picks are kept by. */
  const filesKey = (i: number) => JSON.stringify([pairs[i]?.video, pairs[i]?.target]);
  const paired = (i: number) => !!pairs[i]?.video && !!pairs[i]?.target;

  /** Why row `i`'s files can't be read, if one can't. */
  const unreadable = (i: number): string[] =>
    [pairs[i]?.video, pairs[i]?.target].flatMap((path) => (path && probes[path]?.error ? [probes[path].error] : []));

  /** Row `i`'s tracks as picked now -- by hand in its detail, else by the
   * top bar -- or null until both its files are read. */
  function resolved(i: number): Resolved | null {
    const pair = pairs[i];
    if (!pair?.video || !pair.target) return null;
    const video = probes[pair.video];
    const standalone = isSubtitleFile(pair.target);
    const other = probes[pair.target];
    if (!video?.tracks || (!standalone && !other?.tracks)) return null;
    const choice = choices[filesKey(i)];
    const ref = resolveTracks(
      video.tracks,
      video.cues,
      referenceKey,
      [],
      choice ? { reference: choice.reference, targets: [] } : undefined,
    );
    if (standalone) {
      return { ...ref, target: { path: pair.target, index: null }, targetTrack: null };
    }
    const tracks = other!.tracks!;
    const picked =
      choice?.target != null
        ? (tracks.find((tr) => tr.index === choice.target) ?? null)
        : (resolveTracks(tracks, other!.cues, "", targetKeys ?? []).targets[0] ?? null);
    const issues = [...ref.issues, ...(picked ? [] : [m.pairs.noTargetTrack])];
    return {
      ...ref,
      issues,
      target: picked ? { path: pair.target, index: picked.index } : null,
      targetTrack: picked,
    };
  }

  /** Row `i`'s analysis as it stands: both files and both tracks. */
  function trackKey(i: number): string | null {
    const res = resolved(i);
    if (!res?.reference || !res.target) return null;
    return JSON.stringify([pairs[i].video, res.reference.index, res.target.path, res.target.index]);
  }
  const runOf = (i: number): AnalysisRun | undefined => {
    const key = trackKey(i);
    return key ? analyses[key] : undefined;
  };
  const exportOf = (i: number): ExportFields | undefined => {
    const key = trackKey(i);
    return key ? exports[key] : undefined;
  };
  const isDone = (a: AnalysisRun | undefined) => a?.status === "done" && !!a.result;

  /** The corrected track's language: picked in its detail, else in the top
   * bar, else its own -- its file's name's, or its track's. */
  function languageOf(i: number): { code: string | null; from: "pair" | "bar" | "name" | "track" } {
    const own = pairExports[filesKey(i)]?.language;
    if (own) return { code: own, from: "pair" };
    if (addedLanguage) return { code: addedLanguage, from: "bar" };
    const target = pairs[i]?.target;
    if (target && isSubtitleFile(target)) return { code: languageCode(probes[target]?.language), from: "name" };
    return { code: languageCode(resolved(i)?.targetTrack?.language), from: "track" };
  }

  /** The reference video's track the corrected one takes the place of on an
   * MKV export: the one picked in its detail, or by default (Remplacer) the
   * first full one in its language; null: added. */
  function replacesOf(i: number): number | null {
    const own = pairExports[filesKey(i)]?.replaces;
    if (own !== undefined) return own;
    if (!replaceSame) return null;
    const language = languageOf(i).code;
    const tracks = (pairs[i]?.video && probes[pairs[i].video!]?.tracks) || [];
    return tracks.find((tr) => language && languageCode(tr.language) === language && !tr.forced)?.index ?? null;
  }

  function editExport(i: number, patch: PairExport) {
    const key = filesKey(i);
    setPairExports((c) => ({ ...c, [key]: { ...c[key], ...patch } }));
  }

  /** A change to row `i`'s tracks in its detail: from then on they're its
   * own ("(manuel)"), starting from what the top bar picked. */
  function editChoice(i: number, patch: Partial<PairChoice>) {
    const res = resolved(i);
    if (!res) return;
    const key = filesKey(i);
    setChoices((c) => ({
      ...c,
      [key]: { ...(c[key] ?? { reference: res.reference?.index ?? 0, target: res.targetTrack?.index ?? null }), ...patch },
    }));
  }

  function updateRun(key: string, patch: Partial<AnalysisRun> | ((entry: AnalysisRun) => Partial<AnalysisRun>)) {
    setAnalyses((current) =>
      current[key] ? { ...current, [key]: { ...current[key], ...(typeof patch === "function" ? patch(current[key]) : patch) } } : current,
    );
  }

  function updateExport(key: string, patch: (entry: ExportFields) => Partial<ExportFields>) {
    setExports((current) => {
      const entry = current[key] ?? IDLE_EXPORT;
      return { ...current, [key]: { ...entry, ...patch(entry) } };
    });
  }

  const rows = Array.from({ length: rowCount }, (_, i) => i);
  /** Row `i` can be analyzed: both its files read, both its tracks known. */
  const analyzableRow = (i: number) => trackKey(i) !== null && unreadable(i).length === 0;

  /** Analyzes the pairs that aren't yet (new ones, failed ones), keeping the
   * rest and any edit made to them; or all of them again (`all`); of every
   * pair, or of row `only` (its "Analyser"). */
  async function handleAnalyze(all: boolean, only?: number) {
    await runPlan(rows.filter((i) => (only === undefined || i === only) && analyzableRow(i) && (all || !isDone(runOf(i)))));
  }

  /** Analyzes these rows, each one's result and edits replaced; their last
   * exports no longer match. */
  async function runPlan(todo: number[]) {
    const plan = todo.map((i) => {
      const res = resolved(i)!;
      return { key: trackKey(i)!, reference: { path: pairs[i].video!, index: res.reference!.index }, target: res.target! };
    });
    if (plan.length === 0) return;
    setAnalyzing(true);
    setAnalyses((current) => {
      const next = { ...current };
      for (const { key } of plan) next[key] = { status: "pending", result: null, error: null, log: [] };
      return next;
    });
    setExports((current) => {
      const next = { ...current };
      for (const { key } of plan) next[key] = IDLE_EXPORT;
      return next;
    });
    for (const { key, reference, target } of plan) {
      updateRun(key, { status: "running" });
      try {
        const result = await runJob<Analysis>(startAnalyze(reference, target), (message) =>
          updateRun(key, (a) => ({ log: [...a.log, message] })),
        );
        updateRun(key, { status: "done", result, edited: false });
      } catch (err) {
        updateRun(key, { status: "error", error: errorMessage(err) });
      }
    }
    setAnalyzing(false);
  }

  /** Every analyzed pair's export, with its segments as edited ("Modifier"):
   * a new MKV of its reference video holding the corrected track, or that
   * track alone; of every pair, or of row `only` ("Exporter cette paire"). */
  function handleExport(only?: number) {
    queue.run(
      rows
        .filter((i) => (only === undefined || i === only) && isDone(runOf(i)))
        .map((i) => {
          const key = trackKey(i)!;
          const res = resolved(i)!;
          const reference: TrackRef = { path: pairs[i].video!, index: res.reference!.index };
          const target = res.target!;
          const own = pairExports[filesKey(i)];
          return {
            items: [[reference, target]] as [TrackRef, TrackRef][],
            start: (outputs: string[]) =>
              startRenderTracks(
                reference,
                [
                  {
                    target,
                    segments: analyses[key].result!.segments,
                    keep: analyses[key].result!.edits?.keep ?? [],
                    drop: analyses[key].result!.edits?.drop ?? [],
                    clean_skip: analyses[key].result!.edits?.skip ?? [],
                    output: subsOnly ? outputs[0] : null,
                    language: languageOf(i).code,
                    title: own?.title || addedTitle || null,
                    default: flagValue(batchTrack.isDefault),
                    forced: flagValue(batchTrack.forced),
                    replaces: replacesOf(i),
                  },
                ],
                { output: subsOnly ? null : outputs[0], subsOnly, clean: cleanSubtitles },
              ),
            update: (patch: (entry: ExportFields) => Partial<ExportFields>) => updateExport(key, patch),
          };
        }),
    );
  }

  const pairCount = rows.filter(paired).length;
  const analyzedCount = rows.filter((i) => isDone(runOf(i))).length;
  const exportedCount = rows.filter((i) => exportOf(i)?.exportStatus === "done").length;
  const missingCount = rows.filter((i) => analyzableRow(i) && !isDone(runOf(i))).length;
  // The window's next step: the footer's with several pairs, the detail's
  // with one.
  const listNext =
    pairCount > 1 ? nextStep({ analyzing, missing: missingCount, exportable: analyzedCount, exported: exportedCount }) : null;

  /** A row's badge: what's running first, then what's wrong, then how far it got. */
  function pairBadge(i: number): [string, BadgeKind] {
    const st = m.pairs.status;
    if (!paired(i)) return [st.unpaired, "error"];
    if (unreadable(i).length > 0) return [m.multi.status.unreadable, "error"];
    const res = resolved(i);
    if (!res) return [m.multi.status.reading, "idle"];
    const run = runOf(i);
    const badge = runBadge(run ? [run.status] : [], exportOf(i)?.exportStatus, st);
    // Paired by order: maybe not the same episode, whatever the analysis says.
    const byOrder = pairs[i].by === "order";
    if (badge?.[1] === "analyzed" && ((run?.result && weak(run.result)) || byOrder)) return [m.multi.status.check, "warning"];
    const flagged = res.issues.length > 0 || !res.target || byOrder;
    return badge ?? (flagged ? [m.multi.status.check, "warning"] : [st.toAnalyze, "idle"]);
  }

  /** After a row's file to correct: how it was matched. */
  function matchNote(pair: Pair) {
    if (!pair.video || !pair.target) return null;
    if (pair.by === "order")
      return (
        <span className="pair-row-note pair-row-note-flagged" title={m.pairs.byOrderHint}>
          {m.pairs.byOrder}
        </span>
      );
    if (pair.by === "manual") return <span className="pair-row-note">{m.pairs.byHand}</span>;
    return pair.episode ? <span className="pair-row-note">{pair.episode}</span> : null;
  }

  // The detail: the selected row.
  const detail = pairs[selected] as Pair | undefined;
  const detailPaired = paired(selected);
  const detailRes = resolved(selected);
  const detailRun = runOf(selected);
  const detailResult = isDone(detailRun) ? detailRun!.result : null;
  const detailKey = trackKey(selected);
  const detailExport = exportOf(selected);
  const detailVideo = detail?.video ? probes[detail.video] : undefined;
  const detailDuration = detailResult ? analysisDuration(detailResult, detailVideo?.duration ?? null) : 0;
  const detailCues = useMemo(() => detailResult && chartCues(detailResult), [detailResult]);
  // The loupe's stretch, framed on the chart.
  const [loupeView, setLoupeView] = useCueView(detailKey ?? "", detailResult, detailDuration);
  const detailLanguage = languageOf(selected);
  const detailReplaces = replacesOf(selected);
  const detailName = basename(detail?.video ?? detail?.target ?? "");

  /** Where the corrected track's language comes from, for its list's
   * first choice. */
  function languageSource(): string {
    const label = detailLanguage.code ? languageLabel(detailLanguage.code) : m.pairs.languageUnknown;
    if (addedLanguage) return m.pairs.languageFromBar(label);
    return detailLanguage.from === "name" ? m.pairs.languageFromName(label) : m.pairs.languageFromTrack(label);
  }

  // The top bar's choices: what the files of each column offer.
  const referenceOptions = trackOptions(
    pairs.flatMap((p) => (p.video && probes[p.video]?.tracks ? [probes[p.video].tracks!.filter(readable)] : [])),
  );
  const targetVideos = pairs.flatMap((p) =>
    p.target && !isSubtitleFile(p.target) && probes[p.target]?.tracks ? [probes[p.target].tracks!] : [],
  );
  const targetOptions = trackOptions(targetVideos.map((tracks) => tracks.filter(correctable)));

  const editingIndex = editing === null ? -1 : rows.find((i) => trackKey(i) === editing);
  const editingRun = editing ? analyses[editing] : undefined;

  /** A pair's segments and lines kept or taken out, changed by hand: its
   * export is to do again. */
  function saveEdits(key: string, segments: Segment[], edits: CueEdits) {
    updateRun(key, (a) => ({ result: a.result ? withSegments(a.result, segments, edits) : a.result, edited: true }));
    setExports((c) => ({ ...c, [key]: IDLE_EXPORT }));
  }

  /** "file · @1 fre contre @0 eng": what the editor corrects. */
  function editorSubtitle(i: number): string | undefined {
    const res = resolved(i);
    if (!res?.reference || !pairs[i].target) return undefined;
    const label = res.targetTrack ? trackName(res.targetTrack.index, res.targetTrack) : basename(pairs[i].target!);
    return m.editor.subtitle(basename(pairs[i].video!), label, trackName(res.reference.index, res.reference));
  }

  return (
    <main className="batch-main" style={hidden ? { display: "none" } : undefined}>
      {rowCount === 0 ? (
        <EmptyWorkspace title={m.pairs.emptyTitle} hint={m.pairs.emptyHint}>
          <div className="pairs-empty-zones">
            <DropZone title={m.pairs.dropReferences} disabled={dropBlocked !== null} onClick={pickVideos}>
              {m.pairs.dropReferencesHint}
            </DropZone>
            <DropZone title={m.pairs.dropCandidates} disabled={dropBlocked !== null} onClick={pickTargets}>
              {m.pairs.dropCandidatesHint}
            </DropZone>
          </div>
          <ModeCards mode="pairs" onChange={onModeChange} />
        </EmptyWorkspace>
      ) : (
        <>
          <div className="batch-config panel">
            <span className="config-field">
              {m.common.labelled(m.pairs.reference)}
              <TrackFilterPicker
                label={m.common.reference}
                options={referenceOptions}
                value={referenceKey ? [referenceKey] : []}
                onChange={([key]) => setReferenceKey(key)}
                single
                disabled={busy}
              />
            </span>
            {targetVideos.length > 0 && (
              <span className="config-field">
                {m.common.labelled(m.pairs.toCorrect)}
                <TrackFilterPicker
                  label={m.common.toCorrect}
                  options={targetOptions}
                  value={targetKeys ?? []}
                  onChange={setTargetKeys}
                  disabled={busy}
                />
              </span>
            )}
            <InfoTip>{m.pairs.hint}</InfoTip>
          </div>

          <div className={`workspace workspace-pairs${collapsed ? " list-collapsed" : ""}`}>
            <section className="panel file-list">
              <div className="file-list-header">
                <h2>
                  {m.pairs.pairsCount(pairCount)} <InfoTip>{m.pairs.pairsHint}</InfoTip>
                </h2>
                <RemoveAllButton
                  results={Object.values(analyses).some((a) => a.status === "done")}
                  disabled={busy}
                  onRemove={() => {
                    setPairs([]);
                    setChoices({});
                    setPairExports({});
                    setAnalyses({});
                    setExports({});
                    // Picked again from the next files added.
                    setReferenceKey("");
                    setTargetKeys(null);
                  }}
                />
                <FoldButton collapsed={collapsed} />
              </div>

              <ul className="file-list-rows list-scroll">
                {pairs.map((pair, i) => {
                  const [badge, badgeKind] = pairBadge(i);
                  const run = runOf(i);
                  const res = resolved(i);
                  return (
                    <PairRow
                      key={`${pair.video}|${pair.target}`}
                      reference={{ name: basename(pair.video ?? ""), path: pair.video ?? undefined, missing: m.pairs.noReference }}
                      candidate={{ name: basename(pair.target ?? ""), path: pair.target ?? undefined, missing: m.pairs.noCandidate }}
                      note={matchNote(pair)}
                      referenceActions={
                        <MoveButtons count={rowCount} index={i} disabled={busy} onChange={(update) => changeColumn(i, "video", update)} />
                      }
                      candidateActions={
                        <MoveButtons count={rowCount} index={i} disabled={busy} onChange={(update) => changeColumn(i, "target", update)} />
                      }
                      state={rowState(
                        run ? [run] : [],
                        exportOf(i)?.exportStatus,
                        !paired(i) || unreadable(i).length > 0 || (res?.issues.length ?? 0) > 0,
                      )}
                      badge={badge}
                      badgeKind={badgeKind}
                      badgeAlert={!paired(i) || badgeKind === "warning"}
                      selected={i === selected}
                      onSelect={() => setSelected(i)}
                    />
                  );
                })}
              </ul>
              <div className="pair-add">
                <button disabled={busy} title={m.pairs.addReferenceHint} onClick={pickVideos}>
                  {/* The short label in the folded list. */}
                  <span data-short={`+ ${m.pairs.refShort}`}>{m.pairs.addReferences}</span>
                  <span>{m.pairs.dropLeft}</span>
                </button>
                <button disabled={busy} title={m.pairs.addCandidateHint} onClick={pickTargets}>
                  <span data-short={`+ ${m.pairs.candShort}`}>{m.pairs.addCandidates}</span>
                  <span>{m.pairs.dropRight}</span>
                </button>
              </div>
            </section>

            {detail && (
              <section className="panel file-detail">
                <DetailHeader
                  title={detail.episode && detail.by === "episode" ? `${detail.episode} · ${detailName}` : detailName}
                  titleTooltip={[detail.video, detail.target].filter(Boolean).join("\n")}
                  meta={
                    detailPaired &&
                    (detail.by === "order"
                      ? m.pairs.matchedByOrder
                      : detail.by === "manual"
                        ? m.pairs.matchedByHand
                        : m.pairs.matchedByEpisode(detail.episode))
                  }
                  onReanalyze={
                    detailKey && (detailRun?.status === "done" || detailRun?.status === "error") ? () => runPlan([selected]) : undefined
                  }
                  onEdit={detailResult && detailKey ? () => setEditing(detailKey) : undefined}
                  editDisabled={queue.exporting}
                  missing={analyzableRow(selected) && !isDone(detailRun) ? 1 : 0}
                  analyzing={detailRun?.status === "pending" || detailRun?.status === "running"}
                  done={isDone(detailRun) ? 1 : 0}
                  exported={detailExport?.exportStatus === "done"}
                  primary={pairCount === 1}
                  disabled={busy || blocked}
                  analyzeDisabled={!analyzableRow(selected)}
                  blockedTitle={blocked ? m.batch.otherModeBusy : undefined}
                  analyzeTitle={m.pairs.analyzePairHint}
                  exportLabel={m.pairs.exportPair}
                  onAnalyze={() => handleAnalyze(false, selected)}
                  onExport={() => handleExport(selected)}
                />

                {!detailPaired && <p className="placeholder">{m.pairs.unpairedDetail}</p>}
                {unreadable(selected).map((error) => (
                  <p key={error} className="error">
                    {error}
                  </p>
                ))}
                {detailPaired && unreadable(selected).length === 0 && (
                  <div className="detail-body" ref={view.ref}>
                    {detailRes?.target && (
                      <DetailTabs
                        tracks={[
                          [
                            "target",
                            detailRes.targetTrack
                              ? trackName(detailRes.targetTrack.index, detailRes.targetTrack)
                              : basename(detail!.target!),
                          ],
                        ]}
                        value="target"
                        onChange={() => {}}
                        view={view.compact && detailResult ? { value: view.view, onChange: view.setView } : undefined}
                      />
                    )}
                    <div className={view.topClass(!!detailResult)}>
                      <div className="detail-tracks">
                        <TracksHeading
                          hint={m.pairs.tracksHint}
                          reset={
                            choices[filesKey(selected)]
                              ? {
                                  label: m.pairs.byDefault,
                                  title: m.pairs.byDefaultHint,
                                  disabled: busy,
                                  onClick: () =>
                                    setChoices((c) => {
                                      const next = { ...c };
                                      delete next[filesKey(selected)];
                                      return next;
                                    }),
                                }
                              : undefined
                          }
                        />
                        <div className="tracks-table-wrap list-scroll detail-tracks-table">
                          <PairTrackTable
                            referenceProbe={detailVideo}
                            target={detail!.target!}
                            targetProbe={probes[detail!.target!]}
                            reference={detailRes?.reference?.index ?? null}
                            targetTrack={detailRes?.targetTrack?.index ?? null}
                            disabled={busy}
                            onReference={(index) => editChoice(selected, { reference: index })}
                            onTarget={(index) => editChoice(selected, { target: index })}
                          />
                        </div>
                        {detailRes && detailRes.issues.length > 0 && <Issues issues={detailRes.issues} />}
                        {detailRes?.target && (
                          <div className="pair-export">
                            <span>{m.common.labelled(m.pairs.language)}</span>
                            <LanguageSelect
                              label={m.pairs.language}
                              value={pairExports[filesKey(selected)]?.language ?? ""}
                              onChange={(language) => editExport(selected, { language })}
                              emptyLabel={languageSource()}
                              disabled={busy}
                            />
                            {!subsOnly && (
                              <>
                                <span>{m.common.labelled(m.pairs.title)}</span>
                                <input
                                  {...FIELD_PROPS}
                                  aria-label={m.pairs.title}
                                  title={m.pairs.titleHint}
                                  value={pairExports[filesKey(selected)]?.title ?? ""}
                                  placeholder={
                                    addedTitle ||
                                    (detailReplaces !== null && detailVideo?.tracks?.find((tr) => tr.index === detailReplaces)?.title) ||
                                    m.pairs.titlePlaceholder
                                  }
                                  onChange={(e) => editExport(selected, { title: e.target.value })}
                                  disabled={busy}
                                />
                                <span>{m.common.labelled(m.batch.export)}</span>
                                <Select
                                  label={m.multi.exportOf(basename(detail!.target!))}
                                  value={detailReplaces === null ? "add" : String(detailReplaces)}
                                  options={[
                                    ...(detailVideo?.tracks ?? []).map((tr) => ({
                                      value: String(tr.index),
                                      label: m.multi.exportReplacesTrack(trackName(tr.index, tr)),
                                    })),
                                    { value: "add", label: m.multi.exportAdded },
                                  ]}
                                  onChange={(v) => editExport(selected, { replaces: v === "add" ? null : Number(v) })}
                                  disabled={busy}
                                />
                              </>
                            )}
                          </div>
                        )}
                      </div>

                      <DetailChart
                        summary={
                          <>
                            {detailRes?.reference &&
                              detailRes.target &&
                              m.multi.againstReference(trackName(detailRes.reference.index, detailRes.reference))}
                            {detailRun?.edited && m.multi.edited}
                          </>
                        }
                        run={detailRun}
                        noTrack={detailRes && !detailRes.target ? m.pairs.noTarget : null}
                      >
                        {detailResult && (
                          <div className="detail-summary">
                            <AnalysisSummary
                              analysis={detailResult}
                              edited={detailRun?.edited}
                              cleanup={cleanSubtitles}
                              onEdits={queue.exporting ? undefined : (edits) => saveEdits(detailKey!, detailResult.segments, edits)}
                            />
                            <SegmentChart
                              segments={detailResult.segments}
                              duration={detailDuration}
                              cues={detailCues ?? undefined}
                              view={loupeView}
                              onPick={(time) =>
                                setLoupeView({
                                  start: Math.max(0, Math.min(time - loupeView.duration / 2, detailDuration - loupeView.duration)),
                                  duration: loupeView.duration,
                                })
                              }
                            />
                          </div>
                        )}
                      </DetailChart>
                    </div>

                    {detailResult && (
                      <div className={view.loupeClass()}>
                        <AnalysisView analysis={detailResult} duration={detailDuration} view={loupeView} onView={setLoupeView} />
                      </div>
                    )}
                  </div>
                )}

                <DetailExport entry={detailExport} />
              </section>
            )}
          </div>

          <BatchFooter
            added={{ ...added, onChange: (patch) => setAdded((c) => ({ ...c, ...patch })) }}
            track={{ ...batchTrack, onChange: (patch) => setBatchTrack((c) => ({ ...c, ...patch })) }}
            outputDir={outputDir}
            onOutputDirChange={onOutputDirChange}
            busy={busy}
            blocked={blocked}
            progress={
              <>
                {m.pairs.progressPairs(pairCount)}
                {m.pairs.progressAnalyzed(analyzedCount, pairCount)}
                {exportedCount > 0 && m.pairs.progressExported(exportedCount)}
                {rowCount > pairCount && m.pairs.progressUnpaired(rowCount - pairCount)}
              </>
            }
            analyzeButton={
              <AnalyzeButton
                analyzing={analyzing}
                reading={rows.some((i) => paired(i) && unreadable(i).length === 0 && resolved(i) === null)}
                missing={missingCount}
                analyzed={analyzedCount}
                unit="pair"
                primary={listNext === "analyze"}
                disabled={!rows.some(analyzableRow) || busy || blocked}
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
          duration={analysisDuration(
            editingRun.result,
            editingIndex !== undefined && editingIndex >= 0 && pairs[editingIndex].video
              ? (probes[pairs[editingIndex].video!]?.duration ?? null)
              : null,
          )}
          subtitle={editingIndex !== undefined && editingIndex >= 0 ? editorSubtitle(editingIndex) : undefined}
          onClose={() => setEditing(null)}
          onSave={(segments, edits) => {
            saveEdits(editing, segments, edits);
            setEditing(null);
          }}
        />
      )}
      <DropOverlay
        drag={fileDrag}
        blocked={dropBlocked}
        split={[m.pairs.pickReferences, m.pairs.pickCandidates]}
        hint={m.files.folderHint}
      />
    </main>
  );
}
