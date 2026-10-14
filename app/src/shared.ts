import { open } from "@tauri-apps/plugin-dialog";

/** Below this share of a segment's lines landing on reference lines, flag it. */
export const LOW_CONFIDENCE = 0.8;

export async function pickFiles(title: string, filter: { name: string; extensions: string[] }): Promise<string[]> {
  const picked = await open({ title, multiple: true, filters: [filter] });
  return Array.isArray(picked) ? picked : typeof picked === "string" ? [picked] : [];
}

export async function pickFolder(title: string): Promise<string | null> {
  const picked = await open({ title, directory: true, multiple: false });
  return typeof picked === "string" ? picked : null;
}
