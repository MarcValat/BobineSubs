import { connectJobWS } from "./api";
import { t } from "./i18n";

/** An engine job (analysis, export) as a promise: `onLog` gets its progress
 * messages, `onStart` its id as soon as it's known (to cancel it), and it
 * settles with its result, its error, or JobCancelled.
 *
 * Batch mode awaits one job after the other rather than firing them all at
 * once: each analysis already uses every core (see analysis_cache /
 * features.py), so several at a time would oversubscribe them instead of
 * finishing sooner. Renders are lighter, but kept sequential too, for the
 * same predictable one-at-a-time progress and to avoid writing several
 * large output files to disk at once. */
export function runJob<T>(jobId: Promise<string>, onLog: (message: string) => void, onStart?: (id: string) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    jobId
      .then((id) => {
        onStart?.(id);
        return connectJobWS<T>(id, (event) => {
          if (event.type === "log") onLog(event.message);
          else if (event.type === "done") resolve(event.result);
          else if (event.type === "error") reject(new Error(event.message));
          else if (event.type === "cancelled") reject(new JobCancelled());
        });
      })
      .catch(reject);
  });
}

/** What runJob rejects with when the job was cancelled (see cancelJob). */
export class JobCancelled extends Error {
  constructor() {
    super(t().common.cancelled);
  }
}

/** Where one analysis or export stands. "idle": never started. */
export type RunStatus = "idle" | "pending" | "running" | "done" | "error" | "cancelled";
