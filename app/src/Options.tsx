import { useState } from "react";
import Dialog from "./Dialog";
import { GearIcon } from "./icons";
import { InfoTip } from "./InfoTip";
import { saveCheckUpdates, useCheckUpdates } from "./settings";
import { applyTheme, loadTheme, type ThemeChoice } from "./theme";
import "./Options.css";

const THEMES: [ThemeChoice, string][] = [
  ["system", "Système"],
  ["light", "Clair"],
  ["dark", "Sombre"],
];

/** The ⚙ button, top right, and the Options dialog it opens (from Bobine
 * Audio, with the settings this app has). */
export function OptionsButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="icon-button" title="Options" aria-label="Options" onClick={() => setOpen(true)}>
        <GearIcon />
      </button>
      {open && <OptionsDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function OptionsDialog({ onClose }: { onClose: () => void }) {
  const [theme, setTheme] = useState<ThemeChoice>(loadTheme);
  const checkUpdates = useCheckUpdates();

  function chooseTheme(choice: ThemeChoice) {
    setTheme(choice);
    applyTheme(choice);
  }

  return (
    <Dialog title="Options" onClose={onClose} className="options-panel">
      {/* One setting per row: its name, then its control and explanation. */}
      <div className="options-grid">
        <label htmlFor="options-theme">Thème</label>
        <span className="options-control">
          <select id="options-theme" value={theme} onChange={(e) => chooseTheme(e.target.value as ThemeChoice)}>
            {THEMES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <InfoTip>« Système » suit le thème clair ou sombre de Windows.</InfoTip>
        </span>

        <span className="options-name">Mises à jour</span>
        <span className="options-control">
          <label className="options-check">
            <input type="checkbox" checked={checkUpdates} onChange={(e) => saveCheckUpdates(e.target.checked)} />
            Vérifier au démarrage
          </label>
          <InfoTip>Au lancement, l'application demande à GitHub si une nouvelle version existe ; rien n'est installé sans ton accord.</InfoTip>
        </span>
      </div>
    </Dialog>
  );
}
