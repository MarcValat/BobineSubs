/** A collapsed-by-default progress log (from Bobine Audio) -- the raw lines
 * are useful when something's wrong, but shouldn't take up screen space (or
 * grow the page) while everything's going fine. */
export function LogPanel({ lines, title }: { lines: readonly string[]; title?: string }) {
  if (lines.length === 0) return null;
  return (
    <details className="log-panel">
      <summary>{title ?? `Journal (${lines.length})`}</summary>
      <pre className="log">{lines.join("\n")}</pre>
    </details>
  );
}
