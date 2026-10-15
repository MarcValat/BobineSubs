// The workspace's own behavior: the list (keys, order, removal, folding),
// the settings kept from one session to the next, a file that can't be
// read, the detail as tabs on a low window, the export options. From Bobine
// Audio's.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type App } from "./fixtures";
import { E01, E01_FR, E02, E04, home, multiUrl, pairsUrl } from "./media";

const selected = (app: App) => app.page.locator(".list-row.selected");

test.describe("the list", () => {
  test.beforeEach(async ({ app }) => {
    await app.page.goto(multiUrl(E01, E02, E04));
    await expect(app.rows()).toHaveCount(3);
    await expect(app.page.getByRole("heading", { name: "Fichiers · 3" })).toBeVisible();
  });

  test("↑ ↓ move through the files", async ({ app }) => {
    await app.rows().first().locator(".list-row-main").click();
    await expect(selected(app)).toContainText("Show - S01E01.mkv");
    await app.page.keyboard.press("ArrowDown");
    await expect(selected(app)).toContainText("Show - S01E02.mkv");
    await app.page.keyboard.press("ArrowDown");
    await app.page.keyboard.press("ArrowDown");
    await expect(selected(app)).toContainText("Show - S01E04.mkv");
    await app.page.keyboard.press("ArrowUp");
    await expect(selected(app)).toContainText("Show - S01E02.mkv");
  });

  test("files move up and down, and leave", async ({ app }) => {
    // The row's buttons show on hover.
    const press = async (row: number, name: string) => {
      await app.rows().nth(row).hover();
      await app.rows().nth(row).getByRole("button", { name }).click();
    };
    await press(2, "Monter");
    await expect(app.rows().nth(1)).toContainText("Show - S01E04.mkv");
    await press(0, "Descendre");
    await expect(app.rows().nth(1)).toContainText("Show - S01E01.mkv");
    await press(1, "Retirer");
    await expect(app.rows()).toHaveCount(2);
    await expect(app.rows()).not.toContainText(["Show - S01E01.mkv"]);
  });

  test("each file says what it corrects with what", async ({ app }) => {
    await expect(app.rows().first()).toContainText("Réf. auto @0 eng → @1 fre");
    await expect(app.rows().first().locator(".list-badge")).toHaveText("À analyser");
  });

  test("Tout retirer asks first once there are analyses to lose", async ({ app }) => {
    await app.analyzeAll();
    await app.page.getByRole("button", { name: "Tout retirer" }).click();
    await expect(app.page.getByText("Retirer tous les fichiers ? Leurs analyses et modifications seront perdues.")).toBeVisible();
    await app.page.keyboard.press("Escape");
    await expect(app.rows()).toHaveCount(3);
    await app.page.getByRole("button", { name: "Tout retirer" }).click();
    await app.page.getByRole("button", { name: "Tout retirer" }).last().click();
    await expect(app.rows()).toHaveCount(0);
  });

  test("the folded list stays folded", async ({ app }) => {
    await app.page.getByRole("button", { name: "Replier la liste" }).click();
    await expect(app.page.getByRole("button", { name: "Déplier la liste" })).toBeVisible();
    await app.page.reload();
    await expect(app.page.getByRole("button", { name: "Déplier la liste" })).toBeVisible();
  });
});

test("the mode, the theme and the language are kept from one session to the next", async ({ app }) => {
  await app.page.goto(home());
  await app.page.getByRole("tab", { name: "Paires de fichiers" }).click();
  await app.page.getByRole("button", { name: "Paramètres" }).click();
  const settings = app.page.getByRole("dialog", { name: "Paramètres" });
  await settings.getByRole("tab", { name: "Clair" }).click();
  await expect(app.page.locator("html")).toHaveAttribute("data-theme", "light");
  await settings.getByRole("button", { name: "Langue" }).click();
  await app.page.getByRole("option", { name: "English" }).click();
  await expect(app.page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  await app.page.keyboard.press("Escape");

  await app.page.reload();
  await expect(app.page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(app.page.getByRole("tab", { name: "File pairs" })).toHaveAttribute("aria-selected", "true");
  await expect(app.page.getByRole("button", { name: "Settings" })).toBeVisible();
});

test("a file that can't be read says so, the others go on", async ({ app }) => {
  // The engine answers 400 to its probe.
  app.allowErrors(/HTTP 400 probe|status of 400/);
  const dir = mkdtempSync(join(tmpdir(), "bobine-e2e-bad-"));
  try {
    const bad = join(dir, "Not a video.mkv").replaceAll("\\", "/");
    writeFileSync(bad, "not a video");
    await app.page.goto(multiUrl(bad, E01));
    await expect(app.rows().first().locator(".list-badge")).toHaveText("Illisible");
    await expect(app.footerPrimary()).toBeEnabled({ timeout: 120_000 });
    await app.footerPrimary().click();
    await expect(app.rows().nth(1).locator(".list-badge")).toHaveText(/^Analysé/, { timeout: 120_000 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Analyser tout waits for every file to be read, then takes them all", async ({ app }) => {
  // E04's tracks come 3 s late.
  await app.page.route(/\/probe\?path=.*S01E04/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await route.continue();
  });
  await app.page.goto(multiUrl(E01, E04));
  await expect(app.footerPrimary()).toHaveText("Lecture des pistes…");
  await expect(app.footerPrimary()).toBeDisabled();
  await expect(app.footerPrimary()).toHaveText("Analyser tout", { timeout: 15_000 });
  await app.footerPrimary().click();
  await expect(
    app
      .rows()
      .locator(".list-badge")
      .filter({ hasText: /^Analysé/ }),
  ).toHaveCount(2, { timeout: 120_000 });
});

test("a low window shows the detail as two tabs", async ({ app }) => {
  await app.page.setViewportSize({ width: 1280, height: 720 });
  await app.page.goto(multiUrl(E01));
  await app.analyze();
  const views = app.page.getByRole("tablist", { name: "Affichage" });
  await expect(views).toBeVisible();
  await expect(app.page.locator(".detail-body .loupe")).toBeVisible();
  await views.getByRole("tab", { name: "Segments" }).click();
  await expect(app.page.locator(".detail-body .loupe")).toBeHidden();
  await expect(app.page.locator(".detail-body .segment-chart")).toBeVisible();
  // Room enough: both at once, no tabs.
  await app.page.setViewportSize({ width: 1440, height: 900 });
  await expect(views).toBeHidden();
  await expect(app.page.locator(".detail-body .loupe")).toBeVisible();
});

test("the export options: in pairs, the added track's too", async ({ app }) => {
  await app.page.goto(multiUrl(E01));
  await app.page.getByRole("button", { name: "Modifier…" }).click();
  const dialog = app.page.getByRole("dialog", { name: "Options d'export" });
  await expect(dialog).toContainText("Dossier de sortie");
  await expect(dialog).toContainText("Nettoyer les sous-titres");
  await expect(dialog).not.toContainText("Piste ajoutée");
  await app.page.keyboard.press("Escape");

  await app.page.goto(pairsUrl([E01], [E01_FR]));
  await expect(app.rows()).toHaveCount(1);
  await expect(app.rows().first()).toContainText("S01E01");
  await app.page.getByRole("button", { name: "Modifier…" }).click();
  await expect(dialog).toContainText("Piste ajoutée");
  // Keep the video's own track: the footer says so.
  await dialog.getByRole("tab", { name: "Garder" }).click();
  await app.page.keyboard.press("Escape");
  await expect(app.page.locator(".batch-output")).toContainText("piste ajoutée");
  await expect(app.page.locator(".pair-export")).toContainText("ajoutée à la vidéo");
});
