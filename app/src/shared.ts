import { open } from "@tauri-apps/plugin-dialog";
import { loadSetting, saveSetting } from "./util";

/** Below this share of a segment's lines landing on reference lines, flag it. */
export const LOW_CONFIDENCE = 0.8;

/** What a file dialog picks, each kind starting in the folder its last
 * pick came from: the videos holding the reference, and the files to
 * correct (subtitles, or videos holding the track). */
export type PickKind = "references" | "targets";

const folderKey = (kind: PickKind) => `syncsubtitles.lastFolder.${kind}`;

function folderOf(path: string): string | null {
  const cut = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return cut > 0 ? path.slice(0, cut) : null;
}

export async function pickFiles(title: string, filter: { name: string; extensions: string[] }, kind: PickKind): Promise<string[]> {
  const picked = await open({ title, multiple: true, filters: [filter], defaultPath: loadSetting(folderKey(kind)) ?? undefined });
  const files = Array.isArray(picked) ? picked : typeof picked === "string" ? [picked] : [];
  const folder = files.length > 0 ? folderOf(files[0]) : null;
  if (folder) saveSetting(folderKey(kind), folder);
  return files;
}

/** The system's folder picker, starting at `defaultPath` when given. */
export async function pickFolder(title: string, defaultPath?: string | null): Promise<string | null> {
  const picked = await open({ title, directory: true, multiple: false, defaultPath: defaultPath ?? undefined });
  return typeof picked === "string" ? picked : null;
}
