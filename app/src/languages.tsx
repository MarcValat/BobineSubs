import { Select } from "./Dropdown";
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

/** "fra", "fr" -> "fre": two language codes compared (as the engine's
 * language_code). */
export const languageCode = (code: string | null | undefined) => (code === "fra" || code === "fr" ? "fre" : (code ?? null));

/** A language picker: the ones the files at hand use (`extra`), plus the
 * usual ones unless `onlyExtra` -- to pick among what's there, not to tag
 * a track with a new one. `emptyLabel` names the "" choice (keep the
 * track's own, pick none...). */
export function LanguageSelect({
  value,
  onChange,
  extra = [],
  onlyExtra = false,
  emptyLabel,
  disabled,
  label,
}: {
  value: string;
  onChange: (code: string) => void;
  extra?: (string | null)[];
  onlyExtra?: boolean;
  emptyLabel?: string;
  disabled?: boolean;
  /** Its name for a screen reader, when no <label> wraps it. */
  label?: string;
}) {
  const found = extra.filter((c): c is string => !!c);
  const codes = [...new Set(onlyExtra ? found : [...found, ...Object.keys(languageNames())])];
  return (
    <Select
      label={label ?? ""}
      value={value}
      options={[
        ...(emptyLabel !== undefined ? [{ value: "", label: emptyLabel }] : []),
        ...codes.map((code) => ({ value: code, label: languageLabel(code) })),
      ]}
      onChange={onChange}
      disabled={disabled}
    />
  );
}
