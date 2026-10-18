// The engine, asked directly by the tests (not through the page): what an
// exported file holds, and when its lines start.
import { execFileSync } from "node:child_process";
import { ENGINE_PORT } from "./media";

const ENGINE = `http://127.0.0.1:${ENGINE_PORT}`;
// The dev builds' token (see playwright.config.ts).
const HEADERS = { "X-Bobine-Token": "bobine-dev" };

export interface ProbedFile {
  tracks: { index: number; codec: string; language: string | null; title: string | null; forced: boolean; default: boolean }[];
  cue_count: number | null;
}

export async function probe(path: string): Promise<ProbedFile> {
  const resp = await fetch(`${ENGINE}/probe?path=${encodeURIComponent(path)}`, { headers: HEADERS });
  if (!resp.ok) throw new Error(`probe ${path}: ${resp.status} ${await resp.text()}`);
  return resp.json();
}

let ffmpeg: string | null = null;

/** Each line's (start, end), in seconds: as subtitleStarts. */
export function subtitleTimes(file: string, index?: number): [number, number][] {
  const srt = readSubtitles(file, index);
  const time = (h: string, m: string, s: string, ms: string) => +h * 3600 + +m * 60 + +s + +ms / 1000;
  return [...srt.matchAll(/^(\d+):(\d+):(\d+),(\d+) --> (\d+):(\d+):(\d+),(\d+)/gm)].map(
    ([, h, m, s, ms, h2, m2, s2, ms2]) => [time(h, m, s, ms), time(h2, m2, s2, ms2)] as [number, number],
  );
}

/** When each line starts, in seconds: of `file`'s subtitle track `index`
 * (among its subtitles), or of a subtitle file (no index). */
export function subtitleStarts(file: string, index?: number): number[] {
  return subtitleTimes(file, index).map(([start]) => start);
}

/** `file`'s subtitle track `index` (or a subtitle file) as SRT text. With
 * -copyts: else ffmpeg moves what it reads to start at 0. */
function readSubtitles(file: string, index?: number): string {
  ffmpeg ??= execFileSync(
    "uv",
    ["run", "--project", "../engine", "python", "-c", "from syncsubtitles.ffmpeg_backend import resolve_ffmpeg; print(resolve_ffmpeg())"],
    { encoding: "utf8" },
  ).trim();
  const map = index === undefined ? [] : ["-map", `0:s:${index}`];
  return execFileSync(ffmpeg, ["-v", "error", "-copyts", "-i", file, ...map, "-f", "srt", "-"], { encoding: "utf8" });
}

/** Whether `starts` are `expected` moved by `shift` (each line within
 * `tolerance`): the same lines, as many, in order. */
export function shiftedBy(starts: number[], expected: number[], shift: number, tolerance = 0.02): string | null {
  if (starts.length !== expected.length) return `${starts.length} lines, ${expected.length} expected`;
  const off = starts.findIndex((t, i) => Math.abs(t - (expected[i] + shift)) > tolerance);
  return off < 0 ? null : `line ${off + 1}: ${starts[off]} instead of ${(expected[off] + shift).toFixed(3)}`;
}
