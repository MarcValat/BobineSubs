import type { TrackInfo } from "./api";
import { useT } from "./i18n";
import { basename } from "./paths";
import { correctable, readable } from "./TrackFilter";
import { trackName } from "./Workspace";

/** A standalone subtitle file added to a file's tracks to correct
 * ("+ Ajouter des sous-titres"): corrected and added to the video. */
export interface ExternalTrack {
  path: string;
  format: string | null;
  cues: number | null;
  checked: boolean;
}

/** A file's subtitle tracks, one row each: index, language, format (forced
 * ones said so), how many lines, then the reference / tracks-to-correct
 * picks. An image track (PGS, VobSub) can be the reference, not corrected;
 * a track the engine can't read, neither. Then the standalone files added
 * to correct (`externals`), as rows of their own. From Bobine Audio's. */
export function TrackTable({
  tracks,
  cues,
  externals = [],
  className,
  reference,
  targets = [],
  onReference,
  onToggleTarget,
  onToggleExternal,
  radioName = "reference",
  disabled = false,
}: {
  tracks: TrackInfo[];
  /** Each track's lines (by index); null while they're read. */
  cues: Record<number, number> | null;
  externals?: ExternalTrack[];
  className?: string;
  reference?: number | null;
  targets?: number[];
  onReference: (index: number) => void;
  onToggleTarget: (index: number) => void;
  onToggleExternal?: (path: string) => void;
  /** Radio group name: unique per table on screen. */
  radioName?: string;
  /** The picks can't be changed (something's running). */
  disabled?: boolean;
}) {
  const t = useT();
  return (
    <table className={className}>
      <thead>
        <tr>
          <th>{t.tracks.track}</th>
          <th>{t.tracks.language}</th>
          <th>{t.tracks.format}</th>
          <th title={t.tracks.cuesHint}>{t.tracks.cues}</th>
          <th className="track-pick">{t.tracks.referenceShort}</th>
          <th className="track-pick">{t.tracks.toCorrectShort}</th>
        </tr>
      </thead>
      <tbody>
        {tracks.map((tr) => (
          // Its name in the container on hover, and why an image track can't be corrected.
          <tr
            key={tr.index}
            title={
              [tr.title && t.tracks.titled(tr.title), readable(tr) && !correctable(tr) && t.tracks.imageOnly].filter(Boolean).join(" · ") ||
              undefined
            }
          >
            <td>@{tr.index}</td>
            <td>{tr.language ?? "?"}</td>
            <td>
              {tr.codec}
              {tr.forced && ` · ${t.tracks.forced}`}
            </td>
            <td className="track-cues">{cues?.[tr.index] ?? "—"}</td>
            <td className="track-pick">
              <input
                type="radio"
                aria-label={t.tracks.asReference(trackName(tr.index, tr))}
                name={radioName}
                checked={reference === tr.index}
                disabled={disabled || !readable(tr)}
                onChange={() => onReference(tr.index)}
              />
            </td>
            <td className="track-pick">
              <input
                type="checkbox"
                aria-label={t.tracks.toCorrect(trackName(tr.index, tr))}
                disabled={disabled || reference === tr.index || !correctable(tr)}
                checked={targets.includes(tr.index)}
                onChange={() => onToggleTarget(tr.index)}
              />
            </td>
          </tr>
        ))}
        {externals.map((ext) => (
          <tr key={ext.path} title={ext.path}>
            <td className="track-external" colSpan={2}>
              {basename(ext.path)}
            </td>
            <td>{ext.format ?? "?"}</td>
            <td className="track-cues">{ext.cues ?? "—"}</td>
            <td className="track-pick" />
            <td className="track-pick">
              <input
                type="checkbox"
                aria-label={t.tracks.toCorrect(basename(ext.path))}
                disabled={disabled}
                checked={ext.checked}
                onChange={() => onToggleExternal?.(ext.path)}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
