import { t } from "./i18n";

// The usual languages, by ISO 639-2 code (as Matroska tags tracks), named
// in the UI's language.
const languageNames = (): Record<string, string> => t().languages.names;

/** "French (fre)", or the bare code for one not among the usual ones. */
export function languageLabel(code: string | null): string {
  if (!code) return t().languages.none;
  const name = languageNames()[code];
  return name ? `${name} (${code})` : code;
}
