import { useEffect, useRef, useState, type ReactNode } from "react";
import { probe, readTracks, type TrackInfo } from "./api";
import { moved } from "./batchShared";
import type { RunStatus } from "./jobs";
import { errorMessage, shortcutKey } from "./util";
import { useT } from "./i18n";
import { ArrowDownIcon, ArrowUpIcon, CloseIcon, FoldIcon, LayersIcon, LinkIcon, WarningIcon } from "./icons";
import { Tooltip } from "./InfoTip";
import { saveListCollapsed } from "./settings";
import "./Workspace.css";

/** "@1 fre": a track as the list, the detail and the editor name it; "@1"
 * alone while its file isn't read, or when it has no language. */
export function trackName(index: number, track?: TrackInfo | null): string {
  return track?.language ? `@${index} ${track.language}` : `@${index}`;
}

/** The workspace's two ways (picked in the top bar): files that each hold
 * the reference and the tracks to correct, or pairs of files. */
export type BatchMode = "multi" | "pairs";

/** A mode's workspace with no file yet: what it does, its drop zone(s),
 * and anything under them (the mode cards). */
export function EmptyWorkspace({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <section className="empty-workspace">
      <div className="empty-workspace-intro">
        <h1>{title}</h1>
        <p>{hint}</p>
      </div>
      {children}
    </section>
  );
}

/** Both modes side by side, what each takes; the current one marked, a
 * click on the other switches to it (not without `onChange`: something's
 * running). */
export function ModeCards({ mode, onChange }: { mode: BatchMode; onChange?: (mode: BatchMode) => void }) {
  const t = useT();
  const cards: [BatchMode, ReactNode, string, string][] = [
    ["multi", <LayersIcon />, t.batch.multiMode, t.modes.multiHint],
    ["pairs", <LinkIcon />, t.batch.pairsMode, t.modes.pairsHint],
  ];
  return (
    <div className="mode-cards">
      {cards.map(([value, icon, name, hint]) => (
        <button
          key={value}
          className={`mode-card mode-card-${value}${value === mode ? " on" : ""}`}
          aria-pressed={value === mode}
          disabled={!onChange && value !== mode}
          title={!onChange && value !== mode ? t.modes.busy : undefined}
          onClick={() => onChange?.(value)}
        >
          <span className="mode-card-title">
            {icon}
            <span>{name}</span>
            {value === mode && <span className="mode-card-chosen">{t.modes.chosen}</span>}
          </span>
          <span className="mode-card-hint">{hint}</span>
        </button>
      ))}
    </div>
  );
}

/** "Tout retirer", in a list's header: at once while nothing would be lost,
 * otherwise asking first, on a line under the header (`results`: analyses
 * or edits would go with the files). Escape keeps them. */
export function RemoveAllButton({ results, disabled, onRemove }: { results: boolean; disabled: boolean; onRemove: () => void }) {
  const t = useT();
  const [asking, setAsking] = useState(false);
  const confirm = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!asking) return;
    confirm.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setAsking(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [asking]);
  return (
    <>
      <button
        className={`small-button${asking ? " icon-button-on" : ""}`}
        disabled={disabled}
        aria-expanded={results ? asking : undefined}
        onClick={() => (results ? setAsking(!asking) : onRemove())}
      >
        {t.common.removeAll}
      </button>
      {asking && (
        <div className="remove-all-confirm" role="alertdialog" aria-label={t.common.removeAllQuestion}>
          <span>{t.common.removeAllQuestion}</span>
          <button
            ref={confirm}
            className="small-button export-cancel"
            disabled={disabled}
            onClick={() => {
              setAsking(false);
              onRemove();
            }}
          >
            {t.common.removeAll}
          </button>
          <button className="small-button" onClick={() => setAsking(false)}>
            {t.common.keep}
          </button>
        </div>
      )}
    </>
  );
}

/** What's off with a file's tracks ("aucune piste fre"), behind the
 * warning sign: under its name in the list, under its tracks table. */
export function Issues({ issues }: { issues: string[] }) {
  return (
    <span className="list-row-issues">
      <WarningIcon /> {issues.join(", ")}
    </span>
  );
}

/** How a list row's badge is tinted: what it's at (see rowState), or a
 * warning for a file whose tracks need checking. */
export type BadgeKind = "idle" | "queued" | "running" | "analyzed" | "exported" | "error" | "warning";

/** A row's badge words for where its analyses and export are at. */
interface RunLabels {
  exporting: string;
  running: string;
  pending: string;
  exported: string;
  exportFailed: string;
  failed: string;
  cancelled: string;
  analyzed: string;
}

/** A row's badge from its analyses (a file's corrected tracks, a pair's)
 * and its export: what's running first, then what went wrong, then how far
 * it got. Null while none has run: the mode says what's missing. */
export function runBadge(
  statuses: (RunStatus | undefined)[],
  exportStatus: RunStatus | undefined,
  l: RunLabels,
): [string, BadgeKind] | null {
  if (exportStatus === "running") return [l.exporting, "running"];
  if (statuses.includes("running")) return [l.running, "running"];
  if (statuses.includes("pending")) return [l.pending, "queued"];
  if (exportStatus === "done") return [l.exported, "exported"];
  if (exportStatus === "error") return [l.exportFailed, "error"];
  if (statuses.includes("error")) return [l.failed, "error"];
  if (statuses.length > 0 && statuses.every((s) => s === "done")) {
    return [exportStatus === "cancelled" ? l.cancelled : l.analyzed, "analyzed"];
  }
  return null;
}

/** A listed file's subtitle tracks and length, how many lines each track
 * has (null: not read yet), or why it can't be read. */
export interface FileProbe {
  tracks: TrackInfo[] | null;
  duration: number | null;
  cues: Record<number, number> | null;
  error: string | null;
}

/** Every file of `paths` read once, as soon as it's listed (absent: not
 * read yet): its tracks at once, then every track's lines, one file at a
 * time in the background (the engine keeps them for the analysis). */
export function useProbes(paths: string[]): Record<string, FileProbe> {
  const [probes, setProbes] = useState<Record<string, FileProbe>>({});
  const requested = useRef(new Set<string>());
  const listed = useRef<string[]>([]);
  const reading = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    listed.current = paths;
    for (const path of paths) {
      if (requested.current.has(path)) continue;
      requested.current.add(path);
      probe(path)
        .then((res) => {
          setProbes((p) => ({ ...p, [path]: { tracks: res.tracks, duration: res.duration, cues: null, error: null } }));
          if (!res.tracks.some((t) => t.format !== null)) return;
          // One file read at a time, skipped once it's left the list.
          reading.current = reading.current.then(async () => {
            if (!listed.current.includes(path)) return;
            const cues = await readTracks(path).catch(() => ({}));
            setProbes((p) => (p[path] ? { ...p, [path]: { ...p[path], cues } } : p));
          });
        })
        .catch((err) => setProbes((p) => ({ ...p, [path]: { tracks: null, duration: null, cues: null, error: errorMessage(err) } })));
    }
  }, [paths]);
  return probes;
}

/** One file of the workspace's list: its name (the full path on hover),
 * a line saying what's used of it, and a badge saying where it stands, with
 * a colored bar at its left. Clicking it shows it in the detail; its own
 * buttons (move, remove) show on hover, focus and selection. */
export function ListRow({
  name,
  path,
  detail,
  className = "",
  state,
  badge,
  badgeKind,
  badgeAlert = badgeKind === "warning",
  selected,
  onSelect,
  actions,
}: {
  name: ReactNode;
  /** On hover: the full path (a pair's two, one per line). */
  path: string;
  detail: ReactNode;
  /** A look of its own (a pair's). */
  className?: string;
  /** rowState's value, for the bar. */
  state: string;
  badge: string;
  badgeKind: BadgeKind;
  /** The warning sign before it (default: a warning badge's). */
  badgeAlert?: boolean;
  selected: boolean;
  onSelect: () => void;
  actions?: ReactNode;
}) {
  const row = useRef<HTMLLIElement>(null);
  // Selected (by a click, or ↑ ↓ -- see useListKeys): in view, and the
  // focus follows it when it was on another row.
  useEffect(() => {
    if (!selected || !row.current) return;
    row.current.scrollIntoView({ block: "nearest" });
    const focused = document.activeElement;
    if (focused?.classList.contains("list-row-main") && row.current.parentElement?.contains(focused)) {
      row.current.querySelector<HTMLElement>(".list-row-main")?.focus();
    }
  }, [selected]);
  return (
    <li ref={row} className={`list-row list-row-state-${state}${selected ? " selected" : ""} ${className}`}>
      <button className="list-row-main" onClick={onSelect} aria-current={selected || undefined} title={path}>
        <span className="list-row-bar" />
        <span className="list-row-text">
          <span className="list-row-name">{name}</span>
          <span className="list-row-detail">{detail}</span>
        </span>
        <span className="list-row-status">
          <span className={`list-badge list-badge-${badgeKind}`}>
            {badgeAlert && <WarningIcon />}
            {badge}
          </span>
          {/* Something's running on it: the app's spinner (the engine
              doesn't say how far along it is). */}
          {badgeKind === "running" && <span className="spinner spinner-small" aria-hidden="true" />}
        </span>
      </button>
      {actions && <span className="list-row-actions">{actions}</span>}
    </li>
  );
}

// How long the column takes to slide (Workspace.css's .list-folding).
const FOLD_MS = 220;
let foldTimer: number | undefined;

/** Folds or unfolds the list, its column sliding to the new width -- only
 * then: the column's width follows the window's, and a resize of the window
 * mustn't trail behind. */
function foldList(collapsed: boolean) {
  const root = document.documentElement;
  root.classList.add("list-folding");
  window.clearTimeout(foldTimer);
  foldTimer = window.setTimeout(() => root.classList.remove("list-folding"), FOLD_MS + 50);
  saveListCollapsed(collapsed);
}

/** The list header's button folding the list to a narrow column (names and
 * states only, for a small window) or unfolding it; remembered, the same
 * in both modes (useListCollapsed). */
export function FoldButton({ collapsed }: { collapsed: boolean }) {
  const t = useT();
  const label = collapsed ? t.common.unfoldList : t.common.foldList;
  return (
    <Tooltip text={label}>
      <button
        className={`small-button icon-small-button fold-button${collapsed ? " folded" : ""}`}
        aria-label={label}
        aria-expanded={!collapsed}
        onClick={() => foldList(!collapsed)}
      >
        <FoldIcon />
      </button>
    </Tooltip>
  );
}

/** ↑ ↓ select the previous or next row of a shown list (`enabled`), from
 * anywhere in the window but a field, a drop-down or a dialog. */
export function useListKeys(enabled: boolean, count: number, index: number, onSelect: (index: number) => void): void {
  const latest = useRef({ count, index, onSelect });
  latest.current = { count, index, onSelect };
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== "ArrowUp" && e.key !== "ArrowDown") || !shortcutKey(e) || document.querySelector(".dialog-overlay")) return;
      const { count, index, onSelect } = latest.current;
      const next = index + (e.key === "ArrowDown" ? 1 : -1);
      e.preventDefault();
      if (next >= 0 && next < count) onSelect(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}

/** A row's ↑ ↓ ✕: moves it within the list, or drops it. Icons, not
 * characters: a font's arrows sit off-center in a button (and Windows may
 * draw them as emoji). */
export function MoveButtons({
  count,
  index,
  disabled,
  onChange,
}: {
  count: number;
  index: number;
  disabled: boolean;
  onChange: (update: <T>(items: T[]) => T[]) => void;
}) {
  const t = useT();
  return (
    <>
      <Tooltip text={t.batch.moveUp}>
        <button
          className="small-button icon-small-button"
          onClick={() => onChange((f) => moved(f, index, index - 1))}
          disabled={disabled || index === 0}
          aria-label={t.batch.moveUp}
        >
          <ArrowUpIcon />
        </button>
      </Tooltip>
      <Tooltip text={t.batch.moveDown}>
        <button
          className="small-button icon-small-button"
          onClick={() => onChange((f) => moved(f, index, index + 1))}
          disabled={disabled || index === count - 1}
          aria-label={t.batch.moveDown}
        >
          <ArrowDownIcon />
        </button>
      </Tooltip>
      <Tooltip text={t.common.remove}>
        <button
          className="small-button icon-small-button"
          onClick={() => onChange((f) => f.filter((_, i) => i !== index))}
          disabled={disabled}
          aria-label={t.common.remove}
        >
          <CloseIcon />
        </button>
      </Tooltip>
    </>
  );
}
