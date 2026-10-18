// Every screen audited (see audit.ts) at the smallest window and a usual
// one, in both themes and both languages: what's found is listed by screen.
// Exports go to a temporary folder, removed after. From Bobine Audio's.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspect } from "./audit";
import { expect, test, type App } from "./fixtures";
import { BONUS, BONUS_FR, E01, E01_FR, E02, E03, home, multiUrl, pairsUrl } from "./media";

/** Found, and known: awaiting a decision, not to fail the run meanwhile. */
const KNOWN: RegExp[] = [];

const SIZES = [
  [1024, 640],
  [1440, 900],
] as const;

for (const [width, height] of SIZES)
  for (const theme of ["dark", "light"] as const)
    for (const language of ["fr", "en"] as const) {
      test(`${width}x${height} ${theme} ${language}`, async ({ app }) => {
        test.setTimeout(300_000);
        const { page } = app;
        await page.setViewportSize({ width, height });
        await page.emulateMedia({ colorScheme: theme });
        const outDir = mkdtempSync(join(tmpdir(), "bobine-e2e-out-"));
        await page.addInitScript(
          ([language, theme, outDir]) => {
            localStorage.setItem("syncsubtitles.language", language);
            localStorage.setItem("syncsubtitles.theme", theme);
            localStorage.setItem("syncsubtitles.batchOutputDir", outDir);
          },
          [language, theme, outDir.replaceAll("\\", "/")],
        );
        const fr = language === "fr";
        const found: string[] = [];
        /** `screen` reached by `reach`, the pointer out of the way, audited. */
        const audit = async (screen: string, reach: () => Promise<unknown>) => {
          await reach();
          await page.mouse.move(width - 1, height - 1);
          await page.waitForTimeout(450); // transitions done
          for (const [kind, what] of await inspect(page)) {
            const finding = `${screen}: ${kind} -- ${what}`;
            if (!KNOWN.some((known) => known.test(finding))) found.push(finding);
          }
        };
        const escape = () => page.keyboard.press("Escape").then(() => page.waitForTimeout(400));
        /** On a low window the detail is two tabs: `name`'s shown. */
        const tab = async (name: "Segments" | "Loupe") => {
          const views = page.getByRole("tablist", { name: fr ? "Affichage" : "View" });
          if (await views.isVisible()) await views.getByRole("tab", { name }).click();
        };

        await audit("empty multitrack", () => page.goto(`${home()}&windowControls=1`));
        await audit("empty pairs", () => page.getByRole("tab", { name: fr ? "Paires de fichiers" : "File pairs" }).click());

        await audit("multitrack files", async () => {
          await page.goto(`${multiUrl(E01, E02, E03)}&windowControls=1`);
          await expect(app.footerPrimary()).toBeEnabled({ timeout: 120_000 });
        });
        await audit("track picker open", () => page.locator(".batch-config .dropdown-button").first().click());
        await escape();
        await audit("analyzed", async () => {
          await analyzeAll(app);
          await app.rows().first().locator(".list-row-main").click();
        });
        await audit("tracks and chart", () => tab("Segments"));
        await audit("a drift", async () => {
          await app.rows().nth(2).locator(".list-row-main").click();
          await tab("Segments");
        });
        await audit("row hovered", () => app.rows().nth(1).hover());
        await audit("Tout retirer's question", () =>
          page
            .getByRole("button", { name: fr ? "Tout retirer" : "Remove all" })
            .first()
            .click(),
        );
        await escape();
        await audit("subtitles added", async () => {
          await app.rows().first().locator(".list-row-main").click();
          await page.evaluate(
            ([video, srt]) =>
              (window as never as { __test: { addSubtitles: (v: string, s: string[]) => void } }).__test.addSubtitles(video, [srt]),
            [E01, E01_FR],
          );
          await tab("Segments");
          await page.waitForTimeout(500);
        });
        await audit("export options", () => page.getByRole("button", { name: fr ? "Modifier…" : "Edit…" }).click());
        await escape();
        await audit("list folded", () => page.locator(".fold-button:visible").click());
        await page.locator(".fold-button:visible").click();
        await audit("subtitles added, analyzed", () => app.analyze());
        await audit("editor", async () => {
          await page.getByRole("button", { name: fr ? "Modifier les segments" : "Edit segments" }).click();
          await page.locator(".editor-chart").waitFor();
          await page.waitForTimeout(800);
        });
        await audit("editor zoomed, cut, a line picked to align", async () => {
          for (let k = 0; k < 4; k++)
            await page
              .locator(".editor-panel")
              .getByRole("button", { name: fr ? "Zoomer" : "Zoom in", exact: true })
              .click();
          await page
            .locator(".editor-panel")
            .getByRole("button", { name: fr ? "Couper ici" : "Cut here" })
            .click();
          await page.locator(".editor-panel .loupe-row-after .cue.labelled").nth(1).click();
        });
        await audit("editor's question", () => page.keyboard.press("Escape"));
        await page.getByRole("button", { name: fr ? "Abandonner" : "Discard" }).click();
        await audit("settings", () => page.getByRole("button", { name: fr ? "Paramètres" : "Settings" }).click());
        await escape();
        // The written file's line: its name, its folder, its log.
        await audit("exported", async () => {
          await app.rows().nth(1).locator(".list-row-main").click();
          await page.getByRole("button", { name: fr ? "Exporter ce fichier" : "Export this file" }).click();
          await expect(page.locator(".detail-export .render-success")).toBeVisible({ timeout: 120_000 });
        });

        await audit("pairs", async () => {
          await page.goto(`${pairsUrl([E01, BONUS], [E01_FR, BONUS_FR])}&windowControls=1`);
          await expect(app.footerPrimary()).toBeEnabled({ timeout: 120_000 });
        });
        await audit("pairs analyzed", () => analyzeAll(app));
        await audit("pair's tracks", () => tab("Segments"));
        await audit("pairs' export options", () => page.getByRole("button", { name: fr ? "Modifier…" : "Edit…" }).click());
        await escape();
        await audit("pairs folded", () => page.locator(".fold-button:visible").click());

        rmSync(outDir, { recursive: true, force: true });
        expect(found).toEqual([]);
      });
    }

/** Every row analyzed, in either language. */
async function analyzeAll(app: App) {
  await expect(app.rows().filter({ hasText: /Lecture…|Reading…/ })).toHaveCount(0, { timeout: 120_000 });
  await app.footerPrimary().click();
  await expect(app.page.locator(".batch-footer")).toContainText(/Tout réanalyser|Reanalyze all/, { timeout: 300_000 });
  await expect(app.page.locator(".list-badge-running, .list-badge-queued")).toHaveCount(0, { timeout: 300_000 });
}
