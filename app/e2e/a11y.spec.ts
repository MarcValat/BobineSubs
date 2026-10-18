// Accessibility (axe-core, WCAG 2.1 A and AA rules): the main screens and
// dialogs, in both themes. Fails on serious and critical findings; color
// contrast is layout.spec.ts's (it measures what axe can't: text over
// translucent panels). From Bobine Audio's.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type App } from "./fixtures";
import { E01, E01_FR, E02, home, multiUrl, pairsUrl } from "./media";

async function axe(app: App, screen: string, found: string[]) {
  await app.page.mouse.move(1, 1);
  await app.page.waitForTimeout(450);
  const { violations } = await new AxeBuilder({ page: app.page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .disableRules(["color-contrast"])
    .analyze();
  for (const v of violations)
    if (v.impact === "serious" || v.impact === "critical")
      found.push(
        `${screen}: ${v.id} (${v.impact}) ${v.help} -- ${v.nodes
          .map((n) => n.target.join(" "))
          .slice(0, 3)
          .join(" | ")}`,
      );
}

for (const theme of ["dark", "light"] as const) {
  test(`screens and dialogs, ${theme}`, async ({ app }) => {
    test.setTimeout(240_000);
    const { page } = app;
    await page.emulateMedia({ colorScheme: theme });
    const found: string[] = [];
    const escape = () => page.keyboard.press("Escape").then(() => page.waitForTimeout(400));

    await page.goto(`${home()}&windowControls=1`);
    await axe(app, "empty", found);
    await page.goto(`${multiUrl(E01, E02)}&windowControls=1`);
    await app.analyze();
    await axe(app, "analyzed", found);
    await page.locator(".batch-config .dropdown-button").first().click();
    await axe(app, "track picker", found);
    await escape();
    await page.getByRole("button", { name: "Modifier…" }).click();
    await axe(app, "export options", found);
    await escape();
    await app.openEditor();
    await axe(app, "editor", found);
    await escape();
    await page.getByRole("button", { name: "Paramètres" }).click();
    await axe(app, "settings", found);
    await escape();
    await page.goto(pairsUrl([E01], [E01_FR]));
    await app.analyze();
    await axe(app, "pairs", found);

    expect(found).toEqual([]);
  });
}
