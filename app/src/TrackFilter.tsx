import type { TrackInfo } from "./api";
import { Dropdown, DropdownHeading, DropdownOption } from "./Dropdown";
import { t, useT } from "./i18n";
import { languageLabel } from "./languages";

/** Which tracks of each file a batch takes, as MKV Muxing Batch GUI picks
 * them: by number, language or name, or all of them. A key per choice:
 * "all", "index:2", "lang:fre", "name:Français (forcé)" -- and, for the
 * reference, "auto" (the fullest track). Track numbers and names suit files
 * without languages, or two tracks of one language (a full one and a forced
 * one); languages, a track order that changes between episodes. From Bobine
 * Audio. */
export type TrackKey = string;

const ALL_TRACKS: TrackKey = "all";
/** The reference picked in each file: its fullest track (see autoReference). */
const AUTO_REFERENCE: TrackKey = "auto";
const indexKey = (index: number): TrackKey => `index:${index}`;
const languageKey = (code: string): TrackKey => `lang:${code}`;

function split(key: TrackKey): [string, string] {
  const at = key.indexOf(":");
  return at < 0 ? [key, ""] : [key.slice(0, at), key.slice(at + 1)];
}

/** Whether `track` is one `key` names. */
function matchesKey(track: TrackInfo, key: TrackKey): boolean {
  const [kind, value] = split(key);
  if (kind === "all") return true;
  if (kind === "index") return track.index === Number(value);
  if (kind === "lang") return (track.language ?? "") === value;
  if (kind === "name") return (track.title ?? "") === value;
  return false;
}

/** Whether `track` is one of those `keys` name (any of them). */
const matchesAny = (track: TrackInfo, keys: TrackKey[]) => keys.some((key) => matchesKey(track, key));

/** What `key` names, short: "@2", "fre", "« Français »" -- for "aucune piste …". */
function keyName(key: TrackKey): string {
  const [kind, value] = split(key);
  if (kind === "all") return t().picker.all;
  if (kind === "auto") return t().picker.auto;
  if (kind === "index") return `@${value}`;
  if (kind === "name") return t().tracks.titled(value);
  return value;
}

/** What `key` names, in full: "@2", "Français (fre)", "Français (forcé)". */
function keyLabel(key: TrackKey): string {
  const [kind, value] = split(key);
  if (kind === "all") return t().picker.all;
  if (kind === "auto") return t().picker.auto;
  if (kind === "index") return `@${value}`;
  if (kind === "lang") return languageLabel(value);
  return value;
}

/** A track that can be the reference: any the engine reads (text, or image
 * subtitles -- PGS, VobSub -- whose timing is all it needs). */
export const readable = (track: TrackInfo) => track.format !== null;
/** A track that can be corrected: text subtitles only (SRT, ASS). */
export const correctable = (track: TrackInfo) => track.format === "srt" || track.format === "ass";

/** A choice of the list, with what tells it apart. */
interface TrackOption {
  key: TrackKey;
  label: string;
  detail: string;
}

/** The choices the files at hand offer (`files`: each one's tracks, those
 * the picker is for), by section: every track number (what it is in the
 * first file having it), every language and every track name (in how many
 * files). */
export function trackOptions(files: TrackInfo[][]): { indices: TrackOption[]; languages: TrackOption[]; names: TrackOption[] } {
  const firstOf = new Map<number, TrackInfo>();
  const languages = new Map<string, number>();
  const names = new Map<string, number>();
  for (const tracks of files) {
    for (const tr of tracks) if (!firstOf.has(tr.index)) firstOf.set(tr.index, tr);
    for (const code of new Set(tracks.map((tr) => tr.language).filter((l): l is string => !!l))) {
      languages.set(code, (languages.get(code) ?? 0) + 1);
    }
    for (const name of new Set(tracks.map((tr) => tr.title).filter((n): n is string => !!n))) {
      names.set(name, (names.get(name) ?? 0) + 1);
    }
  }
  const m = t().picker;
  return {
    indices: [...firstOf.values()]
      .sort((a, b) => a.index - b.index)
      .map((tr) => ({ key: indexKey(tr.index), label: `@${tr.index}`, detail: [tr.language, tr.codec].filter(Boolean).join(" · ") })),
    languages: [...languages]
      .sort((a, b) => b[1] - a[1])
      .map(([code, n]) => ({ key: languageKey(code), label: languageLabel(code), detail: m.files(n) })),
    names: [...names].map(([name, n]) => ({ key: `name:${name}`, label: name, detail: m.files(n) })),
  };
}

/** The track picker: a drop-down (the app's, Dropdown) of the choices
 * `options` offers, in sections; several ticked (the tracks to correct: any
 * track one of them names), or one picked (`single`: the reference, with
 * "Automatique" first). Closed, it shows the first one and, several, how
 * many of how many. */
export function TrackFilterPicker({
  label,
  options,
  value,
  onChange,
  single = false,
  disabled = false,
}: {
  /** What's picked, for a screen reader. */
  label: string;
  options: ReturnType<typeof trackOptions>;
  value: TrackKey[];
  onChange: (keys: TrackKey[]) => void;
  single?: boolean;
  disabled?: boolean;
}) {
  const m = useT();
  const sections: [string, TrackOption[]][] = [
    [m.picker.byIndex, options.indices],
    [m.picker.byLanguage, options.languages],
    [m.picker.byName, options.names],
  ];
  const all = sections.flatMap(([, list]) => list);

  function pick(key: TrackKey, close: () => void) {
    if (single) {
      onChange([key]);
      close();
    } else {
      onChange(value.includes(key) ? value.filter((k) => k !== key) : [...value, key]);
    }
  }

  const shown = value.includes(ALL_TRACKS) ? m.picker.all : value.length > 0 ? keyLabel(value[0]) : m.picker.nothing;
  const count = !single && value.length > 0 && !value.includes(ALL_TRACKS) ? `${value.length} / ${all.length}` : null;

  return (
    <Dropdown label={label} shown={shown} badge={count} disabled={disabled || all.length === 0} multi={!single}>
      {(close) => (
        <>
          {single && (
            <DropdownOption selected={value.includes(AUTO_REFERENCE)} label={m.picker.auto} onPick={() => pick(AUTO_REFERENCE, close)} />
          )}
          {!single && (
            <DropdownOption check selected={value.includes(ALL_TRACKS)} label={m.picker.all} onPick={() => pick(ALL_TRACKS, close)} />
          )}
          {sections.map(
            ([title, list]) =>
              list.length > 0 && (
                <div key={title} role="group" aria-label={title} className="dropdown-group">
                  <DropdownHeading>{title}</DropdownHeading>
                  {list.map((option) => (
                    <DropdownOption
                      key={option.key}
                      check={!single}
                      selected={value.includes(option.key)}
                      label={option.label}
                      detail={option.detail}
                      onPick={() => pick(option.key, close)}
                    />
                  ))}
                </div>
              ),
          )}
          {!single && value.length > 0 && (
            <div className="dropdown-footer">
              <button className="small-button" onClick={() => onChange([])}>
                {m.picker.none}
              </button>
            </div>
          )}
        </>
      )}
    </Dropdown>
  );
}

/** What a batch starts with, from the first file read (`tracks`): the
 * automatic reference, and French to correct when it has French text
 * subtitles -- else every text language but the fullest track's (likely
 * the reference's), else its text tracks but the first by number. */
export function defaultPick(tracks: TrackInfo[]): { reference: TrackKey; targets: TrackKey[] } {
  const text = tracks.filter(correctable);
  if (text.some((tr) => tr.language === "fre")) return { reference: AUTO_REFERENCE, targets: [languageKey("fre")] };
  const languages = [...new Set(text.map((tr) => tr.language).filter((l): l is string => !!l))];
  if (languages.length > 1) return { reference: AUTO_REFERENCE, targets: languages.slice(1).map(languageKey) };
  return { reference: AUTO_REFERENCE, targets: text.slice(1).map((tr) => indexKey(tr.index)) };
}

/** A file's tracks ticked by hand in its detail's tracks table, instead of
 * the top bar's pick. */
export interface TrackChoice {
  reference: number;
  targets: number[];
}

/** Which of a file's tracks is the reference and which get corrected, and
 * what was off when picking them (shown with the warning sign). */
export interface Resolution {
  reference: TrackInfo | null;
  targets: TrackInfo[];
  issues: string[];
  manual: boolean;
  /** The reference is the automatic one: the fullest track. */
  auto: boolean;
}

/** Among `candidates`, the best reference: a full track before a forced one
 * (a few lines, a poor reference), the one with the most lines (`cues`,
 * once read), text before image -- as the engine's own pick. */
function bestReference(candidates: TrackInfo[], cues: Record<number, number> | null): TrackInfo | null {
  const ranked = [...candidates].sort(
    (a, b) =>
      Number(a.forced) - Number(b.forced) ||
      (cues ? (cues[b.index] ?? 0) - (cues[a.index] ?? 0) : 0) ||
      Number(!correctable(a)) - Number(!correctable(b)) ||
      a.index - b.index,
  );
  return ranked[0] ?? null;
}

/** Whether a file's reference (see resolveTracks) may still change once
 * its tracks' line counts (`cues`) are read: none picked by hand, the
 * counts not read yet, and several tracks it could be, as good but for
 * their counts (none forced, or all). Until then it isn't picked: else an
 * analysis made of one track would then be shown as another's, not done. */
export function awaitsCues(
  tracks: TrackInfo[],
  cues: Record<number, number> | null,
  referenceKey: TrackKey,
  targetKeys: TrackKey[],
  choice?: TrackChoice,
): boolean {
  if (choice || cues !== null) return false;
  const named = referenceKey && referenceKey !== AUTO_REFERENCE ? tracks.filter((tr) => readable(tr) && matchesKey(tr, referenceKey)) : [];
  const candidates = named.length > 0 ? named : tracks.filter((tr) => readable(tr) && !(correctable(tr) && matchesAny(tr, targetKeys)));
  const unforced = candidates.filter((tr) => !tr.forced);
  return (unforced.length > 0 ? unforced : candidates).length > 1;
}

/** A file's tracks as the top bar picks them (by number, language or name,
 * see above), or as ticked in its detail (`choice`). The tracks to correct
 * are its text tracks one of `targetKeys` names; the reference, the best
 * (see bestReference) of those `referenceKey` names among the others -- of
 * all the others with "auto", or when it names none of them. A track to
 * correct that a ticked entry should name but can't is flagged. */
export function resolveTracks(
  tracks: TrackInfo[],
  cues: Record<number, number> | null,
  referenceKey: TrackKey,
  targetKeys: TrackKey[],
  choice?: TrackChoice,
): Resolution {
  if (choice) {
    return {
      reference: tracks.find((tr) => tr.index === choice.reference) ?? null,
      targets: tracks.filter((tr) => choice.targets.includes(tr.index)),
      issues: [],
      manual: true,
      auto: false,
    };
  }
  const named = referenceKey && referenceKey !== AUTO_REFERENCE ? tracks.filter((tr) => readable(tr) && matchesKey(tr, referenceKey)) : [];
  // A reference named on purpose is never corrected, even if a key names it.
  const picked = named.length > 0 ? bestReference(named, cues) : null;
  const targets = tracks.filter((tr) => tr !== picked && correctable(tr) && matchesAny(tr, targetKeys));
  const reference =
    picked ??
    bestReference(
      tracks.filter((tr) => readable(tr) && !targets.includes(tr)),
      cues,
    );
  const issues = targetKeys
    .filter((key) => key !== ALL_TRACKS && !targets.some((tr) => matchesKey(tr, key)))
    .map((key) => t().multi.noTrack(keyName(key)));
  if (!reference) issues.push(t().multi.noReference);
  return { reference, targets, issues, manual: false, auto: picked === null };
}
