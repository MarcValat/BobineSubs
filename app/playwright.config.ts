// The end-to-end tests (npm run test:e2e): the app in Chromium, driven like
// a user, against the real engine and synthetic media (e2e/make_media.py,
// made before the tests by e2e/global-setup.ts). Vite is started for the run
// and stopped after -- or, already running (`tauri dev` or `npm run dev`),
// used as it is. The engine is the tests' own, on its own port (the page
// is pointed at it with ?enginePort=, see e2e/media.ts): never a `tauri dev`
// engine on the app's port, which may run older code. From Bobine Audio.
//
// Not covered here: the real Tauri window (title bar, native dialogs,
// WebView2 / WebKitGTK specifics).
import { defineConfig } from "@playwright/test";
import { ENGINE_PORT } from "./e2e/media";

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  // One at a time: the tests share one engine (its analyses would slow each
  // other down) and one media folder.
  workers: 1,
  fullyParallel: false,
  timeout: 180_000,
  expect: {
    timeout: 15_000,
    // Screenshots compared to the ones recorded on this system (fonts and
    // rendering differ from one to another): e2e/__screenshots__/<platform>.
    toHaveScreenshot: { maxDiffPixelRatio: 0.002, animations: "disabled", caret: "hide" },
  },
  snapshotPathTemplate: "{testDir}/__screenshots__/{platform}/{testFileName}/{arg}{ext}",
  // A screenshot not recorded yet is recorded, the test passing.
  updateSnapshots: "missing",
  reporter: [["list"], ["html", { open: "never", outputFolder: "e2e/report" }]],
  outputDir: "e2e/results",
  use: {
    baseURL: "http://localhost:1420",
    viewport: { width: 1440, height: 900 },
    colorScheme: "dark",
    locale: "fr-FR",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "npx vite --port 1420 --strictPort",
      url: "http://localhost:1420",
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: `uv run --project ../engine syncsubtitles serve --port ${ENGINE_PORT}`,
      url: `http://127.0.0.1:${ENGINE_PORT}/health`,
      reuseExistingServer: true,
      timeout: 120_000,
      // Its request log stays out of the tests' output.
      stdout: "ignore",
      stderr: "ignore",
      // The dev builds' token (src-tauri/src/lib.rs's DEV_TOKEN), which the
      // page sends outside Tauri.
      env: { SYNCSUBTITLES_TOKEN: "bobine-dev" },
    },
  ],
});
