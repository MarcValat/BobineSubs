// The main screens compared to screenshots recorded earlier on this system
// (e2e/__screenshots__/<platform>, not in git: fonts and rendering differ
// between systems). The first run records them; after a wanted change,
// `npm run test:e2e -- e2e/visual.spec.ts --update-snapshots` records them
// again. From Bobine Audio's, the same screens: side by side, they show
// where the two apps differ.
import { expect, test } from "./fixtures";
import { E01, E01_FR, E02, home, multiUrl, pairsUrl } from "./media";

for (const theme of ["dark", "light"] as const) {
  test.describe(theme, () => {
    test.beforeEach(async ({ app }) => {
      await app.page.emulateMedia({ colorScheme: theme });
    });

    test("empty workspace", async ({ app }) => {
      await app.page.goto(`${home()}&windowControls=1`);
      await expect(app.page).toHaveScreenshot(`empty-${theme}.png`);
    });

    test("multitrack, analyzed", async ({ app }) => {
      await app.page.goto(`${multiUrl(E01, E02)}&windowControls=1`);
      await app.analyze();
      await app.page.mouse.move(1, 1);
      await expect(app.page).toHaveScreenshot(`multi-${theme}.png`);
      await app.page.getByRole("button", { name: "Modifier…" }).click();
      await app.page.waitForTimeout(400);
      await expect(app.page).toHaveScreenshot(`export-${theme}.png`);
      await app.page.keyboard.press("Escape");
      await app.openEditor();
      await expect(app.page).toHaveScreenshot(`editor-${theme}.png`);
    });

    test("pairs, analyzed", async ({ app }) => {
      await app.page.goto(`${pairsUrl([E01], [E01_FR])}&windowControls=1`);
      await app.analyze();
      await app.page.mouse.move(1, 1);
      await expect(app.page).toHaveScreenshot(`pairs-${theme}.png`);
    });

    test("settings", async ({ app }) => {
      await app.page.goto(`${home()}&windowControls=1`);
      await app.page.getByRole("button", { name: "Paramètres" }).click();
      await app.page.waitForTimeout(500);
      // The version changes from one release to the next.
      await expect(app.page).toHaveScreenshot(`settings-${theme}.png`, { mask: [app.page.getByText(/Version actuelle/)] });
    });
  });
}
