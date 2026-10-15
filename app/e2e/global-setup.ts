import { execFileSync } from "node:child_process";
import { MEDIA_DIR } from "./media";

/** The synthetic media, made (or found up to date) before any test. */
export default function globalSetup() {
  execFileSync("uv", ["run", "--project", "../engine", "python", "e2e/make_media.py", MEDIA_DIR], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}
