import { useState } from "react";
import { Dialog, DialogHeader } from "./Dialog";
import { GearIcon } from "./icons";
import { useLanguageChoice, useT, type LanguageChoice } from "./i18n";
import { InfoTip } from "./InfoTip";
import { saveCheckUpdates, useCheckUpdates } from "./settings";
import { applyTheme, loadTheme, type ThemeChoice } from "./theme";
import "./Options.css";

const THEMES: ThemeChoice[] = ["system", "light", "dark"];

/** The ⚙ button, top right, and the Options dialog it opens (from Bobine
 * Audio, with the settings this app has). */
export function OptionsButton() {
  const [open, setOpen] = useState(false);
  const t = useT();
  return (
    <>
      <button className="icon-button" title={t.options.title} aria-label={t.options.title} onClick={() => setOpen(true)}>
        <GearIcon />
      </button>
      {open && <OptionsDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function OptionsDialog({ onClose }: { onClose: () => void }) {
  const [theme, setTheme] = useState<ThemeChoice>(loadTheme);
  const checkUpdates = useCheckUpdates();
  const [language, setLanguage] = useLanguageChoice();
  const t = useT();

  function chooseTheme(choice: ThemeChoice) {
    setTheme(choice);
    applyTheme(choice);
  }

  return (
    <Dialog onClose={onClose} closeOnBackdrop className="options-panel" labelledBy="options-title">
      <DialogHeader id="options-title" title={t.options.title} onClose={onClose} />
      {/* One setting per row: its name, then its control and explanation. */}
      <div className="options-grid">
        <label htmlFor="options-theme">{t.options.theme}</label>
        <span className="options-control">
          <select id="options-theme" value={theme} onChange={(e) => chooseTheme(e.target.value as ThemeChoice)}>
            {THEMES.map((value) => (
              <option key={value} value={value}>
                {t.options.themes[value]}
              </option>
            ))}
          </select>
          <InfoTip>{t.options.themeHint}</InfoTip>
        </span>

        <label htmlFor="options-language">{t.options.language}</label>
        <span className="options-control">
          <select id="options-language" value={language} onChange={(e) => setLanguage(e.target.value as LanguageChoice)}>
            <option value="system">{t.options.systemLanguage}</option>
            <option value="fr">Français</option>
            <option value="en">English</option>
          </select>
          <InfoTip>{t.options.languageHint}</InfoTip>
        </span>

        <span className="options-name">{t.options.updates}</span>
        <span className="options-control">
          <label className="options-check">
            <input type="checkbox" checked={checkUpdates} onChange={(e) => saveCheckUpdates(e.target.checked)} />
            {t.options.checkUpdates}
          </label>
          <InfoTip>{t.options.updatesHint}</InfoTip>
        </span>
      </div>
    </Dialog>
  );
}
