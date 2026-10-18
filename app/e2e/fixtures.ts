import { test as base, expect, type Page } from "@playwright/test";
import { readdirSync, rmSync } from "node:fs";
import { MEDIA_DIR } from "./media";

/** A segment as the engine reports it. */
export interface Segment {
  start_s: number;
  end_s: number;
  offset_start: number;
  offset_end: number;
  confidence: number;
}

/** An analysis as the engine reports it (what the tests look at). */
interface AnalysisResult {
  target: { path: string; index: number | null };
  segments: Segment[];
  ratio_name: string | null;
}

/** What the engine's jobs answered, read from their WebSocket: each
 * analysis by its track to correct ("path@index", "path" for a subtitle
 * file), each export's written files. */
class Jobs {
  readonly analyses = new Map<string, AnalysisResult>();
  readonly written: string[] = [];

  watch(page: Page) {
    page.on("websocket", (ws) =>
      ws.on("framereceived", ({ payload }) => {
        const event = JSON.parse(String(payload));
        if (event.type !== "done" || !event.result) return;
        const result = event.result;
        if (result.segments && result.target) {
          const { path, index } = result.target;
          this.analyses.set(index === null ? path.replaceAll("\\", "/") : `${path.replaceAll("\\", "/")}@${index}`, result);
        }
        if (result.tracks) this.written.push(...result.tracks.map((t: { path: string }) => t.path));
      }),
    );
  }

  /** The analysis of `file`'s track `index` (none: `file` is a subtitle file). */
  analysis(file: string, index?: number): AnalysisResult {
    const key = index === undefined ? file : `${file}@${index}`;
    const found = this.analyses.get(key);
    if (!found) throw new Error(`no analysis of ${key} (have: ${[...this.analyses.keys()].join(", ")})`);
    return found;
  }

  segments(file: string, index?: number): Segment[] {
    return this.analysis(file, index).segments;
  }
}

/** What a test drives the app with: its page, and the usual gestures. */
export class App {
  readonly jobs = new Jobs();
  /** Errors a test causes on purpose (see allowErrors). */
  readonly allowed: RegExp[] = [];

  constructor(readonly page: Page) {
    this.jobs.watch(page);
  }

  /** Engine, page or console errors matching `pattern` don't fail the test:
   * it causes them on purpose (a file that can't be read...). */
  allowErrors(pattern: RegExp) {
    this.allowed.push(pattern);
  }

  /** The detail's Analyser, once the files are read; done once the loupe shows. */
  async analyze() {
    const analyze = this.page.locator(".detail-header button", { hasText: /^(Analyser|Analyze)$/ });
    await expect(analyze).toBeEnabled({ timeout: 120_000 });
    await analyze.click();
    await this.page.getByRole("button", { name: /Modifier les segments|Edit segments/ }).waitFor({ timeout: 300_000 });
    // There, if not shown: a low window may show the other tab.
    await this.page.locator(".detail-body .loupe").waitFor({ state: "attached", timeout: 60_000 });
    await this.page.waitForTimeout(300);
  }

  /** The footer's gradient button (Analyser tout, Exporter tout…). */
  footerPrimary() {
    return this.page.locator(".batch-footer .primary-button");
  }

  /** Every listed file analyzed, from the footer: done once it offers to
   * analyze them all again, nothing running. */
  async analyzeAll() {
    // Every file read first: "Analyser tout" only takes those already read.
    await expect(this.rows().filter({ hasText: /Lecture…|Reading…/ })).toHaveCount(0, { timeout: 120_000 });
    await expect(this.footerPrimary()).toBeEnabled({ timeout: 120_000 });
    await this.footerPrimary().click();
    await expect(this.page.locator(".batch-footer")).toContainText(/Tout réanalyser|Reanalyze all/, { timeout: 300_000 });
    await expect(this.page.locator(".list-badge-running, .list-badge-queued")).toHaveCount(0, { timeout: 300_000 });
  }

  rows() {
    return this.page.locator(".list-row");
  }

  async openEditor() {
    await this.page.getByRole("button", { name: /Modifier les segments|Edit segments/ }).click();
    await this.page.locator(".editor-chart").waitFor({ timeout: 60_000 });
    await this.page.waitForTimeout(300);
  }
}

/** Every test fails on an engine error (HTTP 4xx/5xx), a page error, a
 * console error or an export left next to the media, besides its own checks. */
export const test = base.extend<{ app: App }>({
  app: async ({ page }, use) => {
    const problems: string[] = [];
    page.on("response", async (r) => {
      if (r.status() >= 400) {
        const body = await r.text().catch(() => "");
        problems.push(`HTTP ${r.status()} ${r.url().split("?")[0].split("/").pop()} ${body.slice(0, 160)}`);
      }
    });
    page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error" && !/favicon/.test(m.text())) problems.push(`console: ${m.text().slice(0, 200)}`);
    });
    const app = new App(page);
    await use(app);
    // An export next to the media (the output folder not set in time):
    // removed, and failed.
    const strays = readdirSync(MEDIA_DIR).filter((name) => name.includes(".synced") || /\.\w{3}\.(srt|ass)$/.test(name));
    for (const name of strays) rmSync(`${MEDIA_DIR}/${name}`);
    expect(strays, "exports written next to the media").toEqual([]);
    expect(
      problems.filter((p) => !app.allowed.some((pattern) => pattern.test(p))),
      "engine, page or console errors",
    ).toEqual([]);
  },
});

export { expect };
