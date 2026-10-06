// Client for the engine sidecar (engine/src/syncsubtitles/server.py).
import { ENGINE_URL, engineReady } from "./engine";

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
}

export interface TargetCue {
  start: number;
  end: number;
  text: string;
  /** Segment it was matched in; -1: no counterpart in the reference. */
  group: number;
  /** Where it lands once corrected; null: dropped. */
  corrected: [number, number] | null;
}

export interface Analysis {
  reference: TrackRef;
  target: TrackRef;
  reference_choice: string | null;
  ratio: number;
  ratio_name: string | null;
  segments: Segment[];
  reference_cues: [number, number][];
  target_cues: TargetCue[];
  warnings: string[];
}

export interface RenderResult {
  path: string;
  kind: "subtitles" | "replaced" | "added";
  language: string | null;
  dropped: { start: number; text: string }[];
}

export interface RenderOptions {
  output: string | null;
  subs_only: boolean;
  language: string | null;
  title: string | null;
  default: boolean | null;
}

async function engineFetch(path: string, init?: RequestInit): Promise<Response> {
  await engineReady();
  const resp = await fetch(`${ENGINE_URL}${path}`, init);
  if (!resp.ok) {
    let detail: unknown = `Erreur ${resp.status}`;
    try {
      detail = (await resp.json()).detail ?? detail;
    } catch {
      // not JSON: keep the status
    }
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return resp;
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
export async function defaultOutput(
  reference: string,
  target: TrackRef,
  subsOnly: boolean,
  folder: string | null = null,
): Promise<string> {
  const params = new URLSearchParams({ reference, target: target.path, subs_only: String(subsOnly) });
  if (target.index !== null) params.set("target_index", String(target.index));
  if (folder) params.set("folder", folder);
  return (await (await engineFetch(`/default-output?${params}`)).json()).path;
}

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
}

export async function pairFiles(videos: string[], subtitles: string[]): Promise<FilePair[]> {
  return (await (await postJson("/pairs", { videos, subtitles })).json()).pairs;
}

export async function pathExists(path: string): Promise<boolean> {
  return (await (await engineFetch(`/exists?path=${encodeURIComponent(path)}`)).json()).exists;
}

export async function startAnalyze(reference: TrackRef, target: TrackRef, constant = false): Promise<string> {
  return (await (await postJson("/jobs/analyze", { reference, target, constant })).json()).job_id;
}

export async function startRender(
  reference: TrackRef,
  target: TrackRef,
  segments: Segment[],
  options: RenderOptions,
): Promise<string> {
  return (await (await postJson("/jobs/render", { reference, target, segments, ...options })).json()).job_id;
}

export async function cancelJob(jobId: string): Promise<void> {
  await postJson(`/jobs/${jobId}/cancel`, {});
}

export type JobEvent<T> =
  | { type: "log"; message: string }
  | { type: "done"; result: T }
  | { type: "error"; message: string }
  | { type: "cancelled" };

/** A job's events as they happen; an unexpected close (engine crash) is an error. */
function connectJobWS<T>(jobId: string, onEvent: (event: JobEvent<T>) => void): void {
  const ws = new WebSocket(`${ENGINE_URL.replace("http", "ws")}/jobs/${jobId}/ws`);
  let finished = false;
  ws.onmessage = (msg) => {
    const event = JSON.parse(msg.data) as JobEvent<T>;
    if (event.type !== "log") finished = true;
    onEvent(event);
  };
  ws.onclose = () => {
    if (!finished) onEvent({ type: "error", message: "Le moteur s'est arrêté pendant la tâche." });
  };
}

export class JobCancelled extends Error {
  constructor() {
    super("Annulé");
  }
}

/** A job as a promise: `onLog` gets its progress messages, `onStart` its id
 * (to cancel it); settles with its result, its error, or JobCancelled. */
export function runJob<T>(
  jobId: Promise<string>,
  onLog: (message: string) => void,
  onStart?: (id: string) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    jobId
      .then((id) => {
        onStart?.(id);
        connectJobWS<T>(id, (event) => {
          if (event.type === "log") onLog(event.message);
          else if (event.type === "done") resolve(event.result);
          else if (event.type === "error") reject(new Error(event.message));
          else reject(new JobCancelled());
        });
      })
      .catch(reject);
  });
}
