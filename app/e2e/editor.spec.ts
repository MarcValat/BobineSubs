// The segment editor on a track with a jump (E02's French: +0.5 s, then
// +3.0 s from 300 s): cut, remove, undo / redo, reset, the unsaved changes'
// question, Aligner, the chart and the loupe zoomed together, the
// navigation bar, and what's saved being what's exported. From Bobine
// Audio's.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shiftedBy, subtitleStarts } from "./engine";
import { expect, test, type App } from "./fixtures";
import { E02, multiUrl } from "./media";

const rows = (app: App) => app.page.locator(".editor-table tbody tr");
const editor = (app: App) => app.page.getByRole("dialog", { name: /Corriger les segments/ });
const shown = (app: App) => app.page.locator(".editor-panel .loupe-window");

/** A double click on the chart at `share` of its width: a cut there. */
async function cutAt(app: App, share: number) {
  const box = await app.page.locator(".editor-chart").boundingBox();
  if (!box) throw new Error("no chart");
  await app.page.mouse.dblclick(box.x + box.width * share, box.y + box.height / 2);
}

let outDir: string;

test.beforeEach(async ({ app }) => {
  // Exports go to a temporary folder (read by the app as it starts).
  outDir = mkdtempSync(join(tmpdir(), "bobine-e2e-out-"));
  await app.page.addInitScript((dir) => localStorage.setItem("syncsubtitles.batchOutputDir", dir), outDir.replaceAll("\\", "/"));
  await app.page.goto(multiUrl(E02));
  await app.analyze();
  await app.openEditor();
  await expect(rows(app)).toHaveCount(2);
});

test.afterEach(() => rmSync(outDir, { recursive: true, force: true }));

test("cut, undo, redo, reset", async ({ app }) => {
  await cutAt(app, 0.25);
  await expect(rows(app)).toHaveCount(3);
  await expect(editor(app)).toContainText("Modifié · 1 changement");
  await app.page.keyboard.press("Control+z");
  await expect(rows(app)).toHaveCount(2);
  await app.page.keyboard.press("Control+y");
  await expect(rows(app)).toHaveCount(3);
  await editor(app).getByRole("button", { name: "Défaire" }).click();
  await expect(rows(app)).toHaveCount(2);
  await editor(app).getByRole("button", { name: "Refaire" }).click();
  await expect(rows(app)).toHaveCount(3);
  await editor(app).getByRole("button", { name: "Réinitialiser" }).click();
  await expect(rows(app)).toHaveCount(2);
  // "Couper ici": the loupe's middle -- zoomed in, taken to a fifth of the
  // episode first (its middle, 300 s, is the jump itself: nothing to cut).
  await editor(app).getByRole("button", { name: "30 s" }).click();
  const bar = (await app.page.locator(".cue-navigator-svg").boundingBox())!;
  await app.page.mouse.click(bar.x + bar.width * 0.2, bar.y + bar.height / 2);
  await editor(app).getByRole("button", { name: "Couper ici" }).click();
  await expect(rows(app)).toHaveCount(3);
});

test("closing with unsaved changes asks first", async ({ app }) => {
  await cutAt(app, 0.25);
  await app.page.keyboard.press("Escape");
  await expect(app.page.getByText("Abandonner les modifications non enregistrées ?")).toBeVisible();
  await app.page.getByRole("button", { name: "Continuer l'édition" }).click();
  await expect(rows(app)).toHaveCount(3);
  await app.page.keyboard.press("Escape");
  await app.page.getByRole("button", { name: "Abandonner" }).click();
  await expect(editor(app)).toBeHidden();
  // Nothing kept: the detail still has its two segments.
  await expect(app.page.locator(".detail-body")).toContainText("2 segments");
});

test("the chart and the loupe zoom and move together, the bar too", async ({ app }) => {
  await expect(shown(app)).toHaveText("0:00 – 10:00");
  const chart = (await app.page.locator(".editor-chart").boundingBox())!;
  await app.page.mouse.move(chart.x + chart.width / 2, chart.y + chart.height / 2);
  for (let k = 0; k < 10; k++) await app.page.mouse.wheel(0, -120);
  await expect(shown(app)).not.toHaveText("0:00 – 10:00");
  await editor(app)
    .getByRole("tab", { name: "30 s" })
    .or(editor(app).getByRole("button", { name: "30 s" }))
    .click();
  const before = await shown(app).textContent();
  // The navigation bar's frame dragged right: later in the episode.
  const frame = (await app.page.locator(".cue-navigator-window").boundingBox())!;
  await app.page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2);
  await app.page.mouse.down();
  await app.page.mouse.move(frame.x + 300, frame.y + frame.height / 2, { steps: 6 });
  await app.page.mouse.up();
  await expect(shown(app)).not.toHaveText(before!);
});

test("Aligner moves a line's whole segment onto a reference line", async ({ app }) => {
  await editor(app).getByRole("button", { name: "30 s" }).click();
  const offset = rows(app).first().getByRole("textbox", { name: "Décal. début, segment 1" });
  await expect(offset).toHaveValue("500");
  await app.page.locator(".editor-panel .loupe-row-after .cue.labelled").nth(1).click();
  await expect(app.page.locator(".align-banner")).toContainText("choisie");
  await app.page.locator(".editor-panel .loupe-row-reference .cue.labelled").nth(2).click();
  await expect(app.page.locator(".align-banner")).not.toContainText("choisie");
  await expect(offset).not.toHaveValue("500");
  await expect(editor(app)).toContainText("Modifié · 1 changement");
});

test("what's saved is what's exported", async ({ app }) => {
  // The jump removed: the second segment's +3.0 s stretches over the whole track.
  await rows(app).first().getByRole("button", { name: "Retirer" }).click();
  await expect(rows(app)).toHaveCount(1);
  await editor(app).getByRole("button", { name: "Enregistrer" }).click();
  await expect(editor(app)).toBeHidden();
  await expect(app.page.locator(".detail-body")).toContainText("Décalage constant de +3.000 s");

  await app.page.getByRole("button", { name: "Exporter ce fichier" }).click();
  await expect(app.rows().first().locator(".list-badge")).toHaveText("Exporté", { timeout: 120_000 });
  const written = app.jobs.written[0];
  // Every line 3.0 s earlier, the ones before the jump too (2.5 s too early):
  // the saved segments were used, not the analysis'.
  const original = subtitleStarts(E02, 1).filter((t) => t >= 3.05);
  expect(shiftedBy(subtitleStarts(written, 1), original, -3.0)).toBeNull();
});
