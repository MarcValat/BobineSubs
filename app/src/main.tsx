import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { engineReady } from "./engine";
import "./App.css";

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
