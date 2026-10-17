import { useState } from "react";
import { createPortal } from "react-dom";
import { Dialog, DialogHeader } from "./Dialog";
import { Dropdown, DropdownHeading, DropdownOption } from "./Dropdown";
import { useT } from "./i18n";
import { LanguageSelect } from "./languages";
import { Setting } from "./Options";
import { PillSwitch } from "./PillSwitch";
import {
  CLEAN_KINDS,
  saveCleanKinds,
  saveCleanSubtitles,
  saveSubsOnly,
  useCleanKinds,
  useCleanSubtitles,
  useSubsOnly,
  type CleanKind,
} from "./settings";
import { pickFolder } from "./shared";
import { FIELD_PROPS } from "./util";

/** A flag of the corrected tracks for the whole batch: the replaced
 * track's as it was ("keep": none for an added one), or set. */
export type Flag = "keep" | "yes" | "no";

/** What the engine takes for a flag: null keeps the replaced track's. */
export const flagValue = (flag: Flag): boolean | null => (flag === "keep" ? null : flag === "yes");

/** The corrected tracks' name and flags in the new MKVs, for the whole
 * batch (both modes): "" keeps each track's own name (a pair's detail can
 * still name its own). */
export interface TrackOptions {
  title: string;
  isDefault: Flag;
  forced: Flag;
  onChange: (patch: Partial<Omit<TrackOptions, "onChange">>) => void;
}

export const DEFAULT_TRACK_OPTIONS = { title: "", isDefault: "keep" as Flag, forced: "keep" as Flag };

/** Paires de fichiers: the added track's language in every pair (a pair's
 * detail can say otherwise), and what becomes of the video's own track in
 * its language. */
export interface AddedTrackOptions {
  /** "": each file's own (its name's, its track's). */
  language: string;
  /** The video's track in its language replaced (the default), or kept. */
  replaceSame: boolean;
  onChange: (patch: Partial<Omit<AddedTrackOptions, "onChange">>) => void;
}

/** "Export : à côté des originaux · nouveaux MKV · nettoyés" in a mode's
 * footer, and "Modifier…" opening the export options. From Bobine Audio's:
 * where it has the codec and the tracks' names, Bobine Subs has what an
 * export writes (MKVs or subtitles alone), the cleanup, the corrected
 * tracks' name and flags (`track`), and in pairs the added track (`added`). */
export function ExportChooser({
  outputDir,
  onOutputDirChange,
  track,
  added,
  disabled,
}: {
  outputDir: string | null;
  onOutputDirChange: (dir: string | null) => void;
  track: TrackOptions;
  added?: AddedTrackOptions;
  disabled: boolean;
}) {
  const t = useT();
  const e = t.exportOptions;
  const subsOnly = useSubsOnly();
  const clean = useCleanSubtitles();
  const [open, setOpen] = useState(false);
  const format = [
    subsOnly ? e.subsOnlyShort : e.mkvShort,
    clean && e.cleanShort,
    !subsOnly && track.title && e.titledShort(track.title),
    !subsOnly && track.isDefault !== "keep" && e.defaultShort[track.isDefault],
    !subsOnly && track.forced !== "keep" && e.forcedShort[track.forced],
    added && !subsOnly && (added.replaceSame ? e.replaceShort : e.keepShort),
  ].filter(Boolean);
  return (
    <div className="batch-output">
      <span className="batch-output-label">{e.label}</span>
      <span className={outputDir ? "batch-output-dir batch-output-path" : "batch-output-dir"} title={outputDir ?? undefined}>
        {outputDir ?? t.batch.nextToOriginals}
      </span>
      <span className="batch-output-format" title={format.join(" · ")}>
        · {format.join(" · ")}
      </span>
      <button className="small-button" disabled={disabled} title={added ? e.editHintPairs : e.editHint} onClick={() => setOpen(true)}>
        {e.edit}
      </button>
      {/* At the page's root: inside the footer (a .panel), it took its look. */}
      {open &&
        createPortal(
          <ExportDialog
            outputDir={outputDir}
            onOutputDirChange={onOutputDirChange}
            track={track}
            added={added}
            onClose={() => setOpen(false)}
          />,
          document.body,
        )}
    </div>
  );
}

/** Inchangé / Oui / Non, for a flag of the corrected tracks. */
function FlagSwitch({ label, value, onChange }: { label: string; value: Flag; onChange: (flag: Flag) => void }) {
  const t = useT();
  const f = t.exportOptions.flags;
  return (
    <span className="export-options-choice">
      <span>{t.common.labelled(label)}</span>
      <PillSwitch
        label={label}
        options={[
          ["keep", f.keep],
          ["yes", f.yes],
          ["no", f.no],
        ]}
        value={value}
        onChange={onChange}
      />
    </span>
  );
}

function ExportDialog({
  outputDir,
  onOutputDirChange,
  track,
  added,
  onClose,
}: {
  outputDir: string | null;
  onOutputDirChange: (dir: string | null) => void;
  track: TrackOptions;
  added?: AddedTrackOptions;
  onClose: () => void;
}) {
  const t = useT();
  const e = t.exportOptions;
  const p = t.pairs;
  const subsOnly = useSubsOnly();
  return (
    <Dialog onClose={onClose} closeOnBackdrop className="export-options-panel" labelledBy="export-options-title">
      <DialogHeader id="export-options-title" title={e.title} onClose={onClose} />

      <Setting label={e.folder} hint={e.folderHint}>
        <span className="export-options-folder">
          <span className={outputDir ? "batch-output-dir batch-output-path" : "batch-output-dir"} title={outputDir ?? undefined}>
            {outputDir ?? t.batch.nextToOriginals}
          </span>
          <button
            className="small-button"
            onClick={async () => {
              const dir = await pickFolder(t.batch.outputFolder, outputDir);
              if (dir) onOutputDirChange(dir);
            }}
          >
            {t.batch.chooseFolder}
          </button>
          {outputDir && (
            <button className="small-button" onClick={() => onOutputDirChange(null)} title={t.batch.backNextToOriginalsHint}>
              {t.batch.backNextToOriginals}
            </button>
          )}
        </span>
      </Setting>

      <Setting label={e.kind} hint={e.kindHint}>
        <PillSwitch
          className="pill-switch-wide"
          label={e.kind}
          options={[
            ["mkv", t.batch.newMkv],
            ["subs", t.batch.subsOnly],
          ]}
          value={subsOnly ? "subs" : "mkv"}
          onChange={(v) => saveSubsOnly(v === "subs")}
        />
      </Setting>

      {!subsOnly && (
        <Setting label={e.tracks} hint={e.tracksHint}>
          <label className="export-options-name">
            <span>{t.common.labelled(e.name)}</span>
            <input
              {...FIELD_PROPS}
              type="text"
              value={track.title}
              placeholder={e.nameEmpty}
              onChange={(ev) => track.onChange({ title: ev.target.value })}
            />
          </label>
          <FlagSwitch label={e.isDefault} value={track.isDefault} onChange={(isDefault) => track.onChange({ isDefault })} />
          <FlagSwitch label={e.forced} value={track.forced} onChange={(forced) => track.onChange({ forced })} />
        </Setting>
      )}

      {added && (
        <Setting label={p.addedTrack} hint={p.languageHint} note={e.addedNote}>
          <label className="export-options-choice">
            <span>{t.common.labelled(p.language)}</span>
            <LanguageSelect
              label={p.language}
              value={added.language}
              onChange={(language) => added.onChange({ language })}
              emptyLabel={p.languageAuto}
            />
          </label>
          {!subsOnly && (
            <span className="export-options-choice" title={p.sameLanguageHint}>
              <span>{t.common.labelled(p.sameLanguage)}</span>
              <PillSwitch
                label={p.sameLanguage}
                options={[
                  ["replace", p.replace],
                  ["keep", p.keep],
                ]}
                value={added.replaceSame ? "replace" : "keep"}
                onChange={(v) => added.onChange({ replaceSame: v === "replace" })}
              />
            </span>
          )}
        </Setting>
      )}
    </Dialog>
  );
}

/** The top bar's "Nettoyage": the export's cleanup on or off for every
 * file (each can say otherwise, see AnalysisSummary), and which kinds of
 * fix it makes. */
export function CleanupPicker({ disabled }: { disabled: boolean }) {
  const t = useT();
  const c = t.cleanup;
  const clean = useCleanSubtitles();
  const kinds = useCleanKinds();
  const shown = !clean ? c.off : kinds.length === CLEAN_KINDS.length ? c.all : c.some(kinds.length, CLEAN_KINDS.length);

  function pick(kind: CleanKind) {
    // Off, a kind picked turns it on with that kind.
    if (!clean) {
      saveCleanSubtitles(true);
      if (!kinds.includes(kind)) saveCleanKinds([...kinds, kind]);
    } else {
      saveCleanKinds(kinds.includes(kind) ? kinds.filter((k) => k !== kind) : [...kinds, kind]);
    }
  }

  return (
    <span className="config-field">
      <span title={c.hint}>{t.common.labelled(c.label)}</span>
      <Dropdown label={c.label} shown={shown} disabled={disabled} multi>
        {() => (
          <>
            <DropdownOption check selected={clean} label={c.toggle} onPick={() => saveCleanSubtitles(!clean)} />
            <div role="group" aria-label={c.kindsHeading} className="dropdown-group">
              <DropdownHeading>{c.kindsHeading}</DropdownHeading>
              {CLEAN_KINDS.map((kind) => (
                <DropdownOption key={kind} check selected={clean && kinds.includes(kind)} label={c.names[kind]} onPick={() => pick(kind)} />
              ))}
            </div>
          </>
        )}
      </Dropdown>
    </span>
  );
}
