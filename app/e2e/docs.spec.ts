// The docs' screenshots (docs/screenshots), on the demo series
// (e2e/make_demo.py: synthetic, nothing copyrighted): the multitrack files,
// the segment editor and the file pairs, in both languages and themes, at
// 1440x900 as Bobine Audio's. Only when asked:
//   DOCS=1 npx playwright test e2e/docs.spec.ts
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type App } from "./fixtures";
import { home, MEDIA_DIR } from "./media";

const DEMO_DIR = join(MEDIA_DIR, "demo");
const SHOTS = fileURLToPath(new URL("../../docs/screenshots", import.meta.url));
const demo = (name: string) => encodeURIComponent(`${DEMO_DIR}/${name}`.replaceAll("\\", "/"));
const EPISODES = [1, 2, 3].map((n) => demo(`My Show - S01E0${n}.mkv`));
const SUBTITLES = [1, 2, 3].map((n) => demo(`My Show - S01E0${n}.fr.srt`));

test.skip(!process.env.DOCS, "the docs' screenshots: DOCS=1 to take them");

test.beforeAll(() => {
  execFileSync("uv", ["run", "--project", "../engine", "python", "e2e/make_demo.py", DEMO_DIR], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
});

/** The pointer out of the way, the transitions done, then the shot. */
async function shoot(app: App, name: string) {
  await app.page.mouse.move(1439, 899);
  await app.page.waitForTimeout(600);
  await app.page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

/** The loupe on the first jump: the lines either side of it. */
async function toFirstJump(app: App, fr: boolean) {
  await app.page
    .locator(".detail-body")
    .getByRole("button", { name: fr ? "Saut suivant →" : "Next jump →" })
    .click();
}

for (const language of ["fr", "en"] as const)
  for (const theme of ["light", "dark"] as const) {
    test(`${language} ${theme}`, async ({ app }) => {
      test.setTimeout(600_000);
      const { page } = app;
      const fr = language === "fr";
      await page.emulateMedia({ colorScheme: theme });
      await page.addInitScript(
        ([language, theme]) => {
          localStorage.setItem("syncsubtitles.language", language);
          localStorage.setItem("syncsubtitles.theme", theme);
        },
        [language, theme],
      );
      const suffix = `${language}-${theme}`;

      // Multitrack files: the three episodes analyzed, the first shown.
      await page.goto(home(`&batchFiles=${EPISODES.join("|")}&windowControls=1`));
      await app.analyzeAll();
      await app.rows().first().click();
      await toFirstJump(app, fr);
      await shoot(app, `main-${suffix}`);

      // Its segments in the editor, a line picked to align.
      await app.openEditor();
      // From the whole episode to about 50 s, then on the first jump.
      for (let k = 0; k < 5; k++)
        await page
          .locator(".editor-panel")
          .getByRole("button", { name: fr ? "Zoomer" : "Zoom in", exact: true })
          .click();
      await page
        .locator(".editor-panel")
        .getByRole("button", { name: fr ? "Saut suivant →" : "Next jump →" })
        .click();
      await page.locator(".editor-panel .loupe-row-after .cue.labelled").nth(2).click();
      await expect(page.locator(".editor-panel .cue.picked")).toHaveCount(1);
      await shoot(app, `editor-${suffix}`);
      await page.keyboard.press("Escape");

      // File pairs: each episode's standalone French, paired by number.
      await page.goto(home(`&pairRefs=${EPISODES.join("|")}&pairTargets=${SUBTITLES.join("|")}&windowControls=1`));
      await app.analyzeAll();
      await app.rows().first().click();
      await toFirstJump(app, fr);
      await shoot(app, `pairs-${suffix}`);
    });
  }
