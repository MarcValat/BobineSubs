import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { engineReady } from "./engine";
import { applyTheme, loadTheme } from "./theme";
// Inter, bundled: the same text on Windows and Linux, no network needed.
import "@fontsource-variable/inter";
import "@fontsource-variable/inter/wght-italic.css";
import "./App.css";

// The theme chosen in Options, before the first paint.
applyTheme(loadTheme());

// Wait for the engine from the start: the UI is usable meanwhile.
engineReady().catch(() => {});

// The WebView's own right-click menu is only useful while developing.
if (!import.meta.env.DEV) {
  window.addEventListener("contextmenu", (e) => e.preventDefault());
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
