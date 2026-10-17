import { useEffect, useState } from "react";
import { cleanupPreview, type Analysis, type CleanupChange } from "./api";
import { CLEAN_KINDS, type CleanKind } from "./settings";

/** `analysis` as the export's cleanup will treat it: no fix when it's off
 * for this track (its own choice, else the batch's `clean`), only those of
 * `kinds` otherwise -- asked of the engine (the analysis lists those of
 * every kind), the analysis' own of those kinds meanwhile. */
export function useCleanupView(analysis: Analysis | null | undefined, clean: boolean, kinds: readonly CleanKind[]): Analysis | null {
  const on = analysis ? (analysis.edits?.clean ?? clean) : false;
  const every = kinds.length === CLEAN_KINDS.length;
  const key = analysis && on && !every ? JSON.stringify([analysis.target, analysis.segments, analysis.edits, kinds]) : null;
  const [fetched, setFetched] = useState<{ key: string; changes: CleanupChange[] } | null>(null);
  useEffect(() => {
    if (!key || !analysis || fetched?.key === key) return;
    let current = true;
    cleanupPreview(analysis.target, analysis.segments, kinds, analysis.edits)
      .then((changes) => current && setFetched({ key, changes }))
      .catch(() => {});
    return () => {
      current = false;
    };
    // `key` stands for the analysis and the kinds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!analysis) return null;
  if (!on) return { ...analysis, cleanup_changes: [] };
  if (every) return analysis;
  const changes =
    fetched?.key === key
      ? fetched.changes
      : (analysis.cleanup_changes ?? []).filter((c) => c.kinds.some((k) => kinds.includes(k as CleanKind)));
  return { ...analysis, cleanup_changes: changes };
}
