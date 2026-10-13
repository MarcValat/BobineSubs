// The repository's checks, run locally (GitHub Actions only runs the
// engine's tests and the build, on a release: a check there would block it
// late). Each step runs even when one before it failed; the summary lists
// what failed, and the exit code says whether all passed.
//
//   npm run check             types, formatting, lint, dead code: seconds
//   npm run check -- --full   + clippy and the engine's tests: minutes
//   npm run check -- --staged formatting and lint of the staged files only
//                             (the pre-commit hook, .githooks/pre-commit)
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const app = `${root}app`;
const engine = `${root}engine`;
const tauri = `${root}app/src-tauri`;
const full = process.argv.includes("--full");
const staged = process.argv.includes("--staged");

/** `cmd args…` in `cwd`, its output shown as it comes; true when it passed. */
function run(cwd, cmd, args) {
  return spawnSync(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" }).status === 0;
}

function stagedFiles() {
  const out = spawnSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR"], { cwd: root, encoding: "utf8" });
  return out.stdout.split("\n").filter(Boolean);
}

const steps = [];
if (staged) {
  const files = stagedFiles();
  const appFiles = files.filter((f) => f.startsWith("app/") && !f.startsWith("app/src-tauri/")).map((f) => f.slice(4));
  const pyFiles = files.filter((f) => f.startsWith("engine/") && f.endsWith(".py")).map((f) => f.slice(7));
  const lintable = appFiles.filter((f) => /\.(ts|tsx|mjs|js)$/.test(f));
  if (appFiles.length) steps.push(["Prettier", app, "npx", ["prettier", "--check", "--ignore-unknown", ...appFiles]]);
  if (lintable.length) steps.push(["ESLint", app, "npx", ["eslint", "--max-warnings", "0", ...lintable]]);
  if (pyFiles.length) {
    steps.push(["ruff", engine, "uv", ["run", "ruff", "check", ...pyFiles]]);
    steps.push(["ruff format", engine, "uv", ["run", "ruff", "format", "--check", ...pyFiles]]);
  }
  if (files.some((f) => f.endsWith(".rs"))) steps.push(["cargo fmt", tauri, "cargo", ["fmt", "--check"]]);
} else {
  steps.push(
    ["TypeScript", app, "npx", ["tsc", "--noEmit", "-p", "."]],
    ["Prettier", app, "npx", ["prettier", "--check", "."]],
    ["ESLint", app, "npx", ["eslint", ".", "--max-warnings", "0"]],
    ["knip (dead code)", app, "npx", ["knip"]],
    ["ruff", engine, "uv", ["run", "ruff", "check", "."]],
    ["ruff format", engine, "uv", ["run", "ruff", "format", "--check", "."]],
    ["cargo fmt", tauri, "cargo", ["fmt", "--check"]],
  );
  if (full) {
    // Not while `tauri dev` runs: it holds the same build folder.
    steps.push(["clippy", tauri, "cargo", ["clippy", "--quiet", "--", "-D", "warnings"]]);
    steps.push(["engine tests", engine, "uv", ["run", "pytest", "-q"]]);
  }
}

const failed = [];
for (const [name, cwd, cmd, args] of steps) {
  console.log(`\n── ${name}`);
  const started = Date.now();
  const ok = run(cwd, cmd, args);
  console.log(`${ok ? "✓" : "✗"} ${name} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
  if (!ok) failed.push(name);
}
console.log(failed.length ? `\nFailed: ${failed.join(", ")}` : `\nAll ${steps.length} checks passed.`);
process.exit(failed.length ? 1 : 0);
