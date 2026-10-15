// Both modes from start to finish: the files listed, analyzed (the offset,
// the jump and the drift found where make_media.py put them), exported --
// the export then read back: its tracks, their language and title, its
// corrected lines where the reference's are. Exports go to a temporary
// folder, removed after. From Bobine Audio's.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probe, shiftedBy, subtitleStarts } from "./engine";
import { expect, test, type App, type Segment } from "./fixtures";
import { BONUS, BONUS_FR, E01, E01_FR, E02, E02_FR, E03, E04, multiUrl, pairsUrl } from "./media";

/** Within 50 ms of what was put in (the analysis finds them within ~10). */
const TOLERANCE = 0.05;

function expectConstant(segments: Segment[], offset: number) {
  expect(segments, JSON.stringify(segments)).toHaveLength(1);
  expect(Math.abs(segments[0].offset_start - offset)).toBeLessThan(TOLERANCE);
  expect(Math.abs(segments[0].offset_end - offset)).toBeLessThan(TOLERANCE);
}

let outDir: string;
const out = (name: string) => `${outDir.replaceAll("\\", "/")}/${name}`;
const slashes = (path: string) => path.replaceAll("\\", "/");

test.beforeEach(async ({ app }) => {
  outDir = mkdtempSync(join(tmpdir(), "bobine-e2e-out-"));
  await app.page.addInitScript((dir) => localStorage.setItem("syncsubtitles.batchOutputDir", dir), outDir.replaceAll("\\", "/"));
});

test.afterEach(() => rmSync(outDir, { recursive: true, force: true }));

/** What an export writes, set in the export options' dialog. */
async function setSubsOnly(app: App, subsOnly: boolean) {
  await app.page.getByRole("button", { name: "Modifier…" }).click();
  const dialog = app.page.getByRole("dialog", { name: "Options d'export" });
  await dialog.getByRole("tab", { name: subsOnly ? "Sous-titres seuls" : "Nouveaux MKV" }).click();
  await app.page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
}

test("multitrack files: the offset, the jump and the drift found, a file exported in sync", async ({ app }) => {
  await app.page.goto(multiUrl(E01, E02, E03, E04));
  await expect(app.rows()).toHaveCount(4);
  await app.analyzeAll();

  expectConstant(app.jobs.segments(E01, 1), 1.2);
  expectConstant(app.jobs.segments(E04, 1), -0.8);
  // The jump: +0.5 s, then +3.0 s from about 300 s.
  const jump = app.jobs.segments(E02, 1);
  expect(jump, JSON.stringify(jump)).toHaveLength(2);
  expect(Math.abs(jump[0].offset_end - 0.5)).toBeLessThan(TOLERANCE);
  expect(Math.abs(jump[1].offset_start - 3.0)).toBeLessThan(TOLERANCE);
  expect(Math.abs(jump[1].start_s - 300)).toBeLessThan(2);
  // The drift: a PAL release, +0.3 s at the start, about -24 s at the end.
  const drift = app.jobs.analysis(E03, 1);
  expect(drift.ratio_name).toMatch(/PAL/);
  expect(drift.segments).toHaveLength(1);
  expect(Math.abs(drift.segments[0].offset_start - 0.3)).toBeLessThan(TOLERANCE);
  expect(drift.segments[0].offset_end).toBeLessThan(-23);

  // Analyzed: the next step is the export, as the footer says.
  await expect(app.footerPrimary()).toHaveText("Exporter tout");
  await expect(app.page.locator(".batch-output")).toContainText("nouveaux MKV · nettoyés");

  await app.rows().first().locator(".list-row-main").click();
  await app.page.getByRole("button", { name: "Exporter ce fichier" }).click();
  await expect(app.rows().first().locator(".list-badge")).toHaveText("Exporté", { timeout: 120_000 });
  expect(app.jobs.written.map(slashes)).toEqual([out("Show - S01E01.mkv")]);

  // Its French track in place of the old one, with its language and title,
  // its lines 1.2 s earlier: where the reference's are.
  const written = app.jobs.written[0];
  expect((await probe(written)).tracks.map((t) => [t.index, t.language, t.title])).toEqual([
    [0, "eng", "English"],
    [1, "fre", "Français"],
  ]);
  expect(shiftedBy(subtitleStarts(written, 1), subtitleStarts(E01, 1), -1.2)).toBeNull();
});

test("subtitles only: one file per corrected track, retimed", async ({ app }) => {
  await app.page.goto(multiUrl(E04));
  await app.analyze();
  await setSubsOnly(app, true);
  await expect(app.page.locator(".batch-output")).toContainText("sous-titres seuls");
  await app.page.getByRole("button", { name: "Exporter ce fichier" }).click();
  await expect(app.rows().first().locator(".list-badge")).toHaveText("Exporté", { timeout: 120_000 });
  expect(app.jobs.written.map(slashes)).toEqual([out("Show - S01E04.fre.srt")]);
  expect(shiftedBy(subtitleStarts(app.jobs.written[0]), subtitleStarts(E04, 1), 0.8)).toBeNull();
  // Remembered from one session to the next.
  await app.page.reload();
  await expect(app.page.locator(".batch-output").first()).toContainText("sous-titres seuls");
});

test("a standalone file added to a video takes the place of its track in its language", async ({ app }) => {
  await app.page.goto(multiUrl(E01));
  await expect(app.page.getByRole("checkbox", { name: "À corriger : @1 fre" })).toBeChecked({ timeout: 60_000 });
  await app.page.evaluate(
    ([video, srt]) => (window as never as { __test: { addSubtitles: (v: string, s: string[]) => void } }).__test.addSubtitles(video, [srt]),
    [E01, E01_FR],
  );
  // The video's own French track is no longer corrected itself: replaced.
  await expect(app.page.getByRole("checkbox", { name: "À corriger : @1 fre" })).not.toBeChecked();
  await expect(app.page.locator(".detail-export-choice")).toContainText("remplace @1 fre");
  await app.analyze();
  expectConstant(app.jobs.segments(E01_FR), 0.7);
  await app.page.getByRole("button", { name: "Exporter ce fichier" }).click();
  await expect(app.rows().first().locator(".list-badge")).toHaveText("Exporté", { timeout: 120_000 });
  const written = app.jobs.written[0];
  expect((await probe(written)).tracks.map((t) => [t.language, t.title])).toEqual([
    ["eng", "English"],
    ["fre", "Français"],
  ]);
  expect(shiftedBy(subtitleStarts(written, 1), subtitleStarts(E01_FR), -0.7)).toBeNull();
});

test("pairs: matched by episode or flagged, every offset found, replaced or added", async ({ app }) => {
  await app.page.goto(pairsUrl([E01, E02, BONUS], [E01_FR, E02_FR, BONUS_FR]));
  await expect(app.rows()).toHaveCount(3);
  // By name: "Show - Bonus" first, then the episodes; the bonus by order.
  await expect(app.rows().nth(0)).toContainText("bonus vf.srt");
  await expect(app.rows().nth(0)).toContainText("ordre");
  await expect(app.rows().nth(0).locator(".list-badge")).toHaveText("À vérifier");
  await expect(app.rows().nth(1)).toContainText("S01E01");
  await expect(app.rows().nth(2)).toContainText("S01E02");
  await app.analyzeAll();

  expectConstant(app.jobs.segments(BONUS_FR), 2.0);
  expectConstant(app.jobs.segments(E01_FR), 0.7);
  expectConstant(app.jobs.segments(E02_FR), 1.5);
  // Paired by order: still to check once analyzed.
  await expect(app.rows().nth(0).locator(".list-badge")).toHaveText("À vérifier");

  // E01: the French track replaced (the default), in the language its name gives.
  await app.rows().nth(1).locator(".list-row-main").click();
  await expect(app.page.locator(".pair-export")).toContainText("Français (fre) · d'après le nom");
  await app.page.getByRole("button", { name: "Exporter cette paire" }).click();
  await expect(app.rows().nth(1).locator(".list-badge")).toHaveText("Exportée", { timeout: 120_000 });
  let written = app.jobs.written.at(-1)!;
  expect((await probe(written)).tracks.map((t) => [t.language, t.title])).toEqual([
    ["eng", "English"],
    ["fre", "Français"],
  ]);
  expect(shiftedBy(subtitleStarts(written, 1), subtitleStarts(E01_FR), -0.7)).toBeNull();

  // E02: added beside the video's own, picked in its detail.
  await app.rows().nth(2).locator(".list-row-main").click();
  await app.page
    .locator(".pair-export")
    .getByRole("button", { name: /À l'export/ })
    .click();
  await app.page.getByRole("option", { name: "ajoutée à la vidéo" }).click();
  await app.page.getByRole("button", { name: "Exporter cette paire" }).click();
  await expect(app.rows().nth(2).locator(".list-badge")).toHaveText("Exportée", { timeout: 120_000 });
  written = app.jobs.written.at(-1)!;
  expect((await probe(written)).tracks.map((t) => t.language)).toEqual(["eng", "fre", "fre"]);
  expect(shiftedBy(subtitleStarts(written, 2), subtitleStarts(E02_FR), -1.5)).toBeNull();
});

test("export all: every file written, the footer says so", async ({ app }) => {
  await app.page.goto(multiUrl(E01, E04));
  await app.analyzeAll();
  await expect(app.footerPrimary()).toHaveText("Exporter tout");
  await app.footerPrimary().click();
  await expect(app.rows().locator(".list-badge").filter({ hasText: "Exporté" })).toHaveCount(2, { timeout: 180_000 });
  expect(app.jobs.written.map((w) => slashes(w).split("/").pop()).sort()).toEqual(["Show - S01E01.mkv", "Show - S01E04.mkv"]);
  // All done: no next step left.
  await expect(app.footerPrimary()).toHaveCount(0);
});

test("the corrected tracks' name and flags, for the whole batch", async ({ app }) => {
  await app.page.goto(multiUrl(E04));
  await app.analyze();
  await app.page.getByRole("button", { name: "Modifier…" }).click();
  const dialog = app.page.getByRole("dialog", { name: "Options d'export" });
  await dialog.getByRole("textbox", { name: "Nom :" }).fill("Français (corrigé)");
  await dialog.getByRole("tablist", { name: "Par défaut" }).getByRole("tab", { name: "Oui" }).click();
  await dialog.getByRole("tablist", { name: "Forcée" }).getByRole("tab", { name: "Oui" }).click();
  await app.page.keyboard.press("Escape");
  await expect(app.page.locator(".batch-output")).toContainText("« Français (corrigé) » · par défaut · forcées");
  await app.page.getByRole("button", { name: "Exporter ce fichier" }).click();
  await expect(app.rows().first().locator(".list-badge")).toHaveText("Exporté", { timeout: 120_000 });
  const fre = (await probe(app.jobs.written[0])).tracks[1];
  expect([fre.language, fre.title, fre.default, fre.forced]).toEqual(["fre", "Français (corrigé)", true, true]);
});
