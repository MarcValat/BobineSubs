import type { Messages } from "./fr";

export const en: Messages = {
  common: {
    close: "Close",
    retry: "Retry",
    help: "Help",
    httpError: (status) => `Error ${status}`,
    cancelled: "Cancelled",
    log: (n) => `Log (${n})`,
    connectionLost: "Connection lost before the processing finished (did the engine crash?).",
  },

  startup: {
    starting: "Starting the engine…",
    unreachable: "The analysis engine isn't responding. Try again, or restart the app.",
    unreachableShort: "The engine isn't responding",
  },

  options: {
    title: "Settings",
    theme: "Theme",
    themes: { system: "System", light: "Light", dark: "Dark" },
    themeHint: "“System” follows your system's light or dark theme.",
    language: "Language",
    systemLanguage: "System",
    languageHint: "“System” follows your system's language: French if it's in French, English otherwise.",
    updates: "Updates",
    checkUpdates: "Check at startup",
    updatesHint: "At launch, the app asks GitHub whether a new version exists; nothing is installed without your consent.",
  },

  update: {
    downloadingTitle: (percent) => `Downloading the update${percent !== null ? `: ${percent}%` : "…"}`,
    failedTitle: "The update failed",
    availableTitle: (version) => `Update available: v${version}`,
    failedHeading: "Update failed",
    availableHeading: (version) => `Bobine Subs v${version} is available`,
    restartNote: "The app restarts once the update is downloaded: an analysis or export in progress will be interrupted.",
    install: "Install and restart",
    downloading: (percent) => `Downloading… ${percent !== null ? `${percent}%` : ""}`,
    installing: "Installing, restarting…",
    downloadFailed: (error) => `Download failed: ${error}`,
    installFailed: (error) => `Install failed: ${error}`,
    restart: "Restart the app",
  },
};
