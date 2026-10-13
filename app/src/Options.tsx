import { useEffect, useRef, useState, type ReactNode } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { isTauri } from "@tauri-apps/api/core";
import { InfoTip, Tooltip } from "./InfoTip";
import { PillSwitch } from "./PillSwitch";
import { applyTheme, loadTheme, type ThemeChoice } from "./theme";
import "./Options.css";
import { GearIcon } from "./icons";
import { Dialog, DialogHeader } from "./Dialog";
import { Select } from "./Dropdown";
import { useLanguageChoice, useT, type LanguageChoice } from "./i18n";
import { saveCheckUpdates, useCheckUpdates } from "./settings";

const THEMES: ThemeChoice[] = ["system", "light", "dark"];

/** The ⚙ button, top right, and the settings drawer it opens (shown
 * pressed while it's open). */
export function OptionsButton() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<number | null>(null);

  /** The drawer slides out (CLOSE_MS, see Dialog.css), then goes. */
  function close() {
    if (closing) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setOpen(false);
      return;
    }
    setClosing(true);
    closeTimer.current = window.setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, CLOSE_MS);
  }
  useEffect(
    () => () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    },
    [],
  );

  return (
    <>
      <Tooltip text={t.options.title}>
        <button
          className={`icon-button${open && !closing ? " icon-button-on" : ""}`}
          aria-label={t.options.title}
          aria-expanded={open && !closing}
          onClick={() => (open ? close() : setOpen(true))}
        >
          <GearIcon />
        </button>
      </Tooltip>
      {open && <OptionsDrawer closing={closing} onClose={close} />}
    </>
  );
}

/** How long the drawer takes to slide out (Dialog.css's dialog-slide-out). */
const CLOSE_MS = 220;

/** One setting: its name with what it does in a "?" tip (as everywhere in
 * the suite), its control, and `note`, a fact worth seeing at once. */
function Setting({ label, hint, note, children }: { label: ReactNode; hint?: ReactNode; note?: ReactNode; children?: ReactNode }) {
  const name = <span className="setting-name">{label}</span>;
  return (
    <div className="setting">
      <span className="setting-title">
        {name}
        {hint && <InfoTip>{hint}</InfoTip>}
      </span>
      {children}
      {note && <p className="setting-hint">{note}</p>}
    </div>
  );
}

function OptionsDrawer({ closing, onClose }: { closing: boolean; onClose: () => void }) {
  const t = useT();
  const [theme, setTheme] = useState<ThemeChoice>(loadTheme);
  const [language, setLanguage] = useLanguageChoice();
  const checkUpdates = useCheckUpdates();
  const version = useAppVersion();

  function chooseTheme(choice: ThemeChoice) {
    setTheme(choice);
    applyTheme(choice);
  }

  return (
    <Dialog onClose={onClose} closeOnBackdrop side closing={closing} className="options-drawer" labelledBy="options-title">
      <DialogHeader id="options-title" title={t.options.title} onClose={onClose} />

      <Setting label={t.options.theme} hint={t.options.themeHint}>
        <PillSwitch
          className="pill-switch-wide"
          label={t.options.theme}
          options={THEMES.map((value) => [value, t.options.themes[value]] as const)}
          value={theme}
          onChange={chooseTheme}
        />
      </Setting>

      <Setting label={t.options.language} hint={t.options.languageHint}>
        {/* Each language by its own name, whatever the current one. */}
        <Select
          label={t.options.language}
          value={language}
          options={[
            { value: "system", label: t.options.systemLanguage },
            { value: "fr", label: "Français" },
            { value: "en", label: "English" },
          ]}
          onChange={(choice: LanguageChoice) => setLanguage(choice)}
        />
      </Setting>

      <Setting label={t.options.updates} hint={t.options.updatesHint} note={version && t.options.version(version)}>
        <label className="setting-switch-row">
          <span>{t.options.checkUpdates}</span>
          <input
            type="checkbox"
            role="switch"
            className="switch"
            checked={checkUpdates}
            onChange={(e) => saveCheckUpdates(e.target.checked)}
          />
        </label>
      </Setting>
    </Dialog>
  );
}

/** The app's version, in the installed app (none in a plain browser). */
function useAppVersion(): string | null {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    if (!isTauri()) return;
    getVersion()
      .then(setVersion)
      .catch(() => {});
  }, []);
  return version;
}
