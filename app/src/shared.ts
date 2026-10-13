import { open } from "@tauri-apps/plugin-dialog";
import type { ProbeResponse } from "./api";
import { VIDEO_EXTENSIONS } from "./format";

/** Below this share of a segment's lines landing on reference lines, flag it. */
export const LOW_CONFIDENCE = 0.8;

/** Languages offered for a track added to an MKV (ISO 639-2, as Matroska stores them). */
export const LANGUAGES: [string, string][] = [
  ["fre", "Français"],
  ["eng", "Anglais"],
  ["spa", "Espagnol"],
  ["ger", "Allemand"],
  ["ita", "Italien"],
  ["por", "Portugais"],
  ["jpn", "Japonais"],
];

export function languageName(code: string | null): string {
  return LANGUAGES.find(([c]) => c === code)?.[1] ?? code ?? "?";
}

/** Where one analysis or export stands. */
type Status = "idle" | "running" | "done" | "error" | "cancelled";

export interface Run<T> {
  status: Status;
  log: readonly string[];
  result?: T;
  error?: string;
  jobId?: string;
}

export const IDLE = { status: "idle", log: [] } as const;

/** Tracks that can be corrected (text subtitles). */
export function textTracks(probe: ProbeResponse | null) {
  return probe?.tracks.filter((t) => t.format === "srt" || t.format === "ass") ?? [];
}

export const VIDEO_FILTER = { name: "Vidéos", extensions: VIDEO_EXTENSIONS };

export async function pickFiles(title: string, filter: { name: string; extensions: string[] }): Promise<string[]> {
  const picked = await open({ title, multiple: true, filters: [filter] });
  return Array.isArray(picked) ? picked : typeof picked === "string" ? [picked] : [];
}

export async function pickFolder(title: string): Promise<string | null> {
  const picked = await open({ title, directory: true, multiple: false });
  return typeof picked === "string" ? picked : null;
}
