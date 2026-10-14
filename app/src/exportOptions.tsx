import { useState } from "react";
import { createPortal } from "react-dom";
import { Dialog, DialogHeader } from "./Dialog";
import { useT } from "./i18n";
import { LanguageSelect } from "./languages";
import { Setting } from "./Options";
import { PillSwitch } from "./PillSwitch";
import { saveCleanSubtitles, saveSubsOnly, useCleanSubtitles, useSubsOnly } from "./settings";
import { pickFolder } from "./shared";
import { FIELD_PROPS } from "./util";

/** Paires de fichiers: what the corrected track says of itself in every
 * pair's new MKV (a pair's detail can say otherwise), and what becomes of
 * the video's own track in its language. */
export interface AddedTrackOptions {
  /** "": each file's own (its name's, its track's). */
  language: string;
  title: string;
  isDefault: boolean;
  /** The video's track in its language replaced (the default), or kept. */
  replaceSame: boolean;
  onChange: (patch: Partial<Omit<AddedTrackOptions, "onChange">>) => void;
}

/** "Export : à côté des originaux · nouveaux MKV · nettoyés" in a mode's
 * footer, and "Modifier…" opening the export options. From Bobine Audio's:
 * where it has the codec and the tracks' names, Bobine Subs has what an
 * export writes (MKVs or subtitles alone), the cleanup, and in pairs the
 * added track (`added`). */
export function ExportChooser({
  outputDir,
  onOutputDirChange,
  added,
  disabled,
}: {
  outputDir: string | null;
  onOutputDirChange: (dir: string | null) => void;
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
    added && !subsOnly && (added.replaceSame ? e.replaceShort : e.keepShort),
  ].filter(Boolean);
  return (
    <div className="batch-output">
      <span className="batch-output-label">{e.label}</span>
      <span className={outputDir ? "batch-output-dir batch-output-path" : "batch-output-dir"} title={outputDir ?? undefined}>
        {outputDir ?? t.batch.nextToOriginals}
      </span>
      <span className="batch-output-format">· {format.join(" · ")}</span>
      <button className="small-button" disabled={disabled} title={added ? e.editHintPairs : e.editHint} onClick={() => setOpen(true)}>
        {e.edit}
      </button>
      {/* At the page's root: inside the footer (a .panel), it took its look. */}
      {open &&
        createPortal(
          <ExportDialog outputDir={outputDir} onOutputDirChange={onOutputDirChange} added={added} onClose={() => setOpen(false)} />,
          document.body,
        )}
    </div>
  );
}

function ExportDialog({
  outputDir,
  onOutputDirChange,
  added,
  onClose,
}: {
  outputDir: string | null;
  onOutputDirChange: (dir: string | null) => void;
  added?: AddedTrackOptions;
  onClose: () => void;
}) {
  const t = useT();
  const e = t.exportOptions;
  const p = t.pairs;
  const subsOnly = useSubsOnly();
  const clean = useCleanSubtitles();
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

      <Setting label={t.cleanup.toggle} hint={t.cleanup.hint}>
        <label className="export-options-check">
          <input type="checkbox" checked={clean} onChange={(ev) => saveCleanSubtitles(ev.target.checked)} />
          {e.cleanLabel}
        </label>
      </Setting>

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
            <>
              <label className="export-options-name" title={p.titleHint}>
                <span>{t.common.labelled(p.title)}</span>
                <input
                  {...FIELD_PROPS}
                  type="text"
                  value={added.title}
                  placeholder={p.titlePlaceholder}
                  onChange={(ev) => added.onChange({ title: ev.target.value })}
                />
              </label>
              <label className="export-options-check" title={p.defaultTrackHint}>
                <input type="checkbox" checked={added.isDefault} onChange={(ev) => added.onChange({ isDefault: ev.target.checked })} />
                {p.defaultTrack}
              </label>
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
            </>
          )}
        </Setting>
      )}
    </Dialog>
  );
}
