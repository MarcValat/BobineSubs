import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { loadSetting, saveSetting } from "../util";
import { en } from "./en";
import { fr, type Messages } from "./fr";

export type Language = "fr" | "en";
/** "system" follows Windows; the others force it. */
export type LanguageChoice = "system" | Language;

const CATALOGS: Record<Language, Messages> = { fr, en };
const LANGUAGE_KEY = "syncsubtitles.language";

function loadLanguageChoice(): LanguageChoice {
  const saved = loadSetting(LANGUAGE_KEY);
  return saved === "fr" || saved === "en" ? saved : "system";
}

/** French when Windows is in French, English otherwise (the WebView
 * reports Windows' display language). */
function systemLanguage(): Language {
  return navigator.language.toLowerCase().startsWith("fr") ? "fr" : "en";
}

function resolve(choice: LanguageChoice): Language {
  return choice === "system" ? systemLanguage() : choice;
}

let current: Language = resolve(loadLanguageChoice());

/** The current language's text, for code outside components (labels built
 * by helpers, errors). A component uses useT() instead: it re-renders when
 * the language changes. */
export function t(): Messages {
  return CATALOGS[current];
}

export function currentLanguage(): Language {
  return current;
}

const LanguageContext = createContext<{ choice: LanguageChoice; setChoice: (choice: LanguageChoice) => void }>({
  choice: "system",
  setChoice: () => {},
});

/** Holds the language choice (Options), remembered across sessions. */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<LanguageChoice>(loadLanguageChoice);
  current = resolve(choice);

  useEffect(() => {
    document.documentElement.lang = current;
  }, [choice]);

  function setChoice(next: LanguageChoice) {
    saveSetting(LANGUAGE_KEY, next === "system" ? null : next);
    setChoiceState(next);
  }

  return <LanguageContext.Provider value={{ choice, setChoice }}>{children}</LanguageContext.Provider>;
}

/** The current language's text; the component re-renders when it changes. */
export function useT(): Messages {
  const { choice } = useContext(LanguageContext);
  return CATALOGS[resolve(choice)];
}

/** The language in use (the choice, "system" resolved). */
export function useLanguage(): Language {
  return resolve(useContext(LanguageContext).choice);
}

/** The language setting and its setter, for Options. */
export function useLanguageChoice(): [LanguageChoice, (choice: LanguageChoice) => void] {
  const { choice, setChoice } = useContext(LanguageContext);
  return [choice, setChoice];
}
