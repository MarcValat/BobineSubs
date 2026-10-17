import { fileURLToPath } from "node:url";

/** Where e2e/make_media.py writes the media (ignored by git). */
export const MEDIA_DIR = fileURLToPath(new URL("media", import.meta.url));

/** The tests' own engine (see playwright.config.ts): not the app's 8757. */
export const ENGINE_PORT = 8758;

/** The tests' own Vite (see playwright.config.ts): not `tauri dev`'s 1420. */
export const APP_PORT = 1430;

/** A media file's full path, with forward slashes (as the dev URLs take it). */
const media = (name: string) => `${MEDIA_DIR}/${name}`.replaceAll("\\", "/");

// What make_media.py puts in them: the tests check the analyses against it.
// Each video: @0 eng (the reference), @1 fre (to correct).
export const E01 = media("Show - S01E01.mkv"); // fre +1.2 s
export const E02 = media("Show - S01E02.mkv"); // fre +0.5 s, then +3.0 s from 300 s
export const E03 = media("Show - S01E03.mkv"); // fre a PAL drift: +0.3 s to about -24.1 s
export const E04 = media("Show - S01E04.mkv"); // eng as ASS, fre -0.8 s
export const BONUS = media("Show - Bonus.mkv"); // fre +0.4 s; no episode number
export const E01_FR = media("show.s01e01.fr.srt"); // +0.7 s against E01's eng
export const E02_FR = media("show.s01e02.fr.srt"); // +1.5 s against E02's eng
export const BONUS_FR = media("bonus vf.srt"); // +2.0 s against Bonus's eng

/** The app's page, on the tests' engine, with `params` (see util.ts devParam). */
export const home = (params = "") => `/?enginePort=${ENGINE_PORT}${params}`;

/** The dev URL listing `files` in "Fichiers multipistes". */
export const multiUrl = (...files: string[]) => home(`&batchFiles=${files.map(encodeURIComponent).join("|")}`);

/** The dev URL listing pairs: the reference videos, the files to correct
 * (paired by the engine, by episode number). */
export const pairsUrl = (references: string[], targets: string[]) =>
  home(`&pairRefs=${references.map(encodeURIComponent).join("|")}&pairTargets=${targets.map(encodeURIComponent).join("|")}`);
