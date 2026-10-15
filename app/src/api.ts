// Client for the engine sidecar (engine/src/syncsubtitles/server.py).
import { engineHeaders, engineReady, getEngineToken, getEngineUrl } from "./engine";
import { t } from "./i18n";

export interface TrackInfo {
  index: number;
  codec: string;
  /** "srt"/"ass": can be corrected; "pgs"/"vobsub": reference only; null: unsupported. */
  format: string | null;
  language: string | null;
  title: string | null;
  forced: boolean;
  default: boolean;
}

export interface ProbeResponse {
  path: string;
  /** "container": a video file with tracks; "subtitles": a standalone SRT/ASS. */
  kind: "container" | "subtitles";
  duration: number | null;
  tracks: TrackInfo[];
  cue_count: number | null;
  /** A standalone file's language, from its name ("Film.fr.srt"). */
  language?: string | null;
}

/** A standalone subtitle file (index null), or track `index` of a container
 * (null for the reference: chosen by the engine). */
export interface TrackRef {
  path: string;
  index: number | null;
}

export interface Segment {
  start_s: number;
  end_s: number;
  offset_start: number;
  offset_end: number;
  confidence: number;
  /** The target-time stretch between the previous segment's cues and this
   * one's, fixed once the boundary was edited by hand (see retime.ts's
   * boundaryCut); absent: from the two spans. */
  target_cut?: [number, number] | null;
}

interface TargetCue {
  start: number;
  end: number;
  text: string;
  /** Segment it was matched in; -1: no counterpart in the reference. */
  group: number;
  /** Where it lands once corrected; null: dropped. */
  corrected: [number, number] | null;
}

/** Lines kept though in a stretch the reference lacks, or taken out, by
 * hand: indices into an analysis' target_cues (the engine's RenderTrack
 * keep / drop). */
export interface CueEdits {
  keep: number[];
  drop: number[];
  /** The cleanup's fixes refused, by line (RenderTrack clean_skip). */
  skip?: number[];
  /** Lines given their [start, end] by hand, in reference time, by index
   * (RenderTrack timing). */
  timing?: Record<number, [number, number]>;
}

/** What the export's cleanup does to one line (the engine's cleanup.Change). */
interface CleanupChange {
  index: number;
  kinds: string[];
  before: string;
  /** null: taken out (a site's ad). */
  after: string | null;
  duration_before: number;
  duration_after: number;
}

export interface Analysis {
  /** Lines kept or taken out by hand (app side, sent with the export). */
  edits?: CueEdits;
  reference: TrackRef;
  target: TrackRef;
  reference_choice: string | null;
  ratio: number;
  ratio_name: string | null;
  segments: Segment[];
  /** [start, end, text]; no text for image subtitles. */
  reference_cues: [number, number, string][];
  target_cues: TargetCue[];
  warnings: string[];
  /** What the cleanup would fix in the corrected SRT file, by kind
   * (engine cleanup.clean): empty for ASS, or nothing to fix. */
  cleanup?: Record<string, number>;
  /** The same, line by line: each fix can be refused (edits.skip). */
  cleanup_changes?: CleanupChange[];
}

interface RenderResult {
  path: string;
  kind: "subtitles" | "replaced" | "added";
  language: string | null;
  dropped: { start: number; text: string }[];
}

/** A multi-track export's result: the first track's, then each one's. */
export interface RenderResponse extends RenderResult {
  tracks: RenderResult[];
}

/** One corrected track of an export (see startRenderTracks). */
export interface RenderTrack {
  target: TrackRef;
  segments: Segment[];
  language?: string | null;
  title?: string | null;
  default?: boolean | null;
  /** As `default`: null keeps the replaced track's (none when added). */
  forced?: boolean | null;
  /** Lines kept or taken out by hand (see CueEdits). */
  keep?: number[];
  drop?: number[];
  clean_skip?: number[];
  timing?: Record<number, [number, number]>;
  /** Its own file, in a subtitles-only export. */
  output?: string | null;
  /** The reference file's subtitle track it takes the place of. */
  replaces?: number | null;
}

async function engineFetch(path: string, init?: RequestInit): Promise<Response> {
  await engineReady();
  const headers = new Headers(init?.headers);
  for (const [name, value] of Object.entries(await engineHeaders())) headers.set(name, value);
  const resp = await fetch(`${await getEngineUrl()}${path}`, { ...init, headers });
  if (!resp.ok) {
    let detail: unknown = t().common.httpError(resp.status);
    try {
      detail = (await resp.json()).detail ?? detail;
    } catch {
      // not JSON: keep the status
    }
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return resp;
}

/** Tells the engine the UI's language: its messages (job logs, errors) follow. */
export async function setEngineLanguage(language: string): Promise<void> {
  await postJson("/language", { language });
}

function postJson(path: string, body: unknown): Promise<Response> {
  return engineFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function probe(path: string): Promise<ProbeResponse> {
  return (await engineFetch(`/probe?path=${encodeURIComponent(path)}`)).json();
}

/** Where an export goes by default: next to its source, or in `folder`. */
/** Dropped paths as files, a folder standing for its files with one of
 * `extensions`, in name order. */
export async function expandPaths(paths: string[], extensions: string[]): Promise<string[]> {
  return (await (await postJson("/paths/expand", { paths, extensions })).json()).files;
}

export interface FilePair {
  video: string | null;
  subtitle: string | null;
  /** "episode": same number in both names; "order": by position; null: alone. */
  by: "episode" | "order" | null;
  /** "S01E03" (or "E03"), when paired by episode. */
  episode: string | null;
}

export async function pairFiles(videos: string[], subtitles: string[]): Promise<FilePair[]> {
  return (await (await postJson("/pairs", { videos, subtitles })).json()).pairs;
}

/** Where a batch's exports go, decided together: the original names in
 * another folder when free, ".synced" ones otherwise (see engine outputs.py). */
export async function planOutputs(items: [TrackRef, TrackRef][], subsOnly: boolean, folder: string | null): Promise<string[]> {
  return (await (await postJson("/plan-outputs", { items, subs_only: subsOnly, folder })).json()).paths;
}

export async function startAnalyze(reference: TrackRef, target: TrackRef, constant = false): Promise<string> {
  return (await (await postJson("/jobs/analyze", { reference, target, constant })).json()).job_id;
}

/** Several corrected tracks of one reference file: all in one new MKV
 * (`output`), or each in its own subtitle file (`subsOnly`, each track's
 * `output`). */
export async function startRenderTracks(
  reference: TrackRef,
  tracks: RenderTrack[],
  options: { output: string | null; subsOnly: boolean; clean: boolean },
): Promise<string> {
  const body = { reference, tracks, output: options.output, subs_only: options.subsOnly, clean: options.clean };
  return (await (await postJson("/jobs/render", body)).json()).job_id;
}

/** Every readable subtitle track of a container read (and kept by the
 * engine for the analysis): how many lines each has, by track index. */
export async function readTracks(path: string): Promise<Record<number, number>> {
  return (await (await postJson("/read-tracks", { path })).json()).cues;
}

export async function cancelJob(jobId: string): Promise<void> {
  await postJson(`/jobs/${jobId}/cancel`, {});
}

export type JobEvent<T> =
  { type: "log"; message: string } | { type: "done"; result: T } | { type: "error"; message: string } | { type: "cancelled" };

/** A job's events as they happen; an unexpected close (engine crash) is an error. */
export async function connectJobWS<T>(jobId: string, onEvent: (event: JobEvent<T>) => void): Promise<void> {
  // A WebSocket takes no header: the token goes in its address.
  const token = encodeURIComponent(await getEngineToken());
  const ws = new WebSocket(`${(await getEngineUrl()).replace("http", "ws")}/jobs/${jobId}/ws?token=${token}`);
  let finished = false;
  ws.onmessage = (msg) => {
    const event = JSON.parse(msg.data) as JobEvent<T>;
    if (event.type !== "log") finished = true;
    onEvent(event);
  };
  ws.onclose = () => {
    if (!finished) onEvent({ type: "error", message: t().common.connectionLost });
  };
}
