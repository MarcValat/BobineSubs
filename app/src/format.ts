/** 1:02:03.4 / 2:03.4 */
export function clock(seconds: number, decimals = 1): string {
  const sign = seconds < 0 ? "-" : "";
  const t = Math.abs(seconds);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = (t % 60).toFixed(decimals).padStart(decimals ? 3 + decimals : 2, "0");
  return h ? `${sign}${h}:${String(m).padStart(2, "0")}:${s}` : `${sign}${m}:${s}`;
}

/** +1.060 s */
export function offset(seconds: number): string {
  return `${seconds >= 0 ? "+" : "−"}${Math.abs(seconds).toFixed(3)} s`;
}

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function trackLabel(track: {
  index: number;
  codec: string;
  language: string | null;
  title: string | null;
  forced: boolean;
}): string {
  const parts = [`#${track.index}`, track.language ?? "?", track.codec];
  if (track.title) parts.push(`« ${track.title} »`);
  if (track.forced) parts.push("forcés");
  return parts.join(" · ");
}

export const SUBTITLE_EXTENSIONS = ["srt", "ass", "ssa"];
export const VIDEO_EXTENSIONS = ["mkv", "mp4", "m4v", "m2ts", "ts", "avi", "mov", "webm"];

export function isSubtitleFile(path: string): boolean {
  return SUBTITLE_EXTENSIONS.includes(path.split(".").pop()?.toLowerCase() ?? "");
}
