/** A run of a line's text, changed (taken out of the first, put in the
 * second) or the same in both. */
export interface DiffPart {
  text: string;
  changed: boolean;
}

/** Where two versions of a line differ, character by character (their
 * longest common subsequence): each one's runs, the others' changes marked.
 * Lines are short: a full table is cheap. */
export function textDiff(before: string, after: string): { before: DiffPart[]; after: DiffPart[] } {
  const a = [...before];
  const b = [...after];
  // lcs[i][j]: the common length of a[i..] and b[j..].
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const left: DiffPart[] = [];
  const right: DiffPart[] = [];
  const push = (parts: DiffPart[], text: string, changed: boolean) => {
    const last = parts[parts.length - 1];
    if (last && last.changed === changed) last.text += text;
    else parts.push({ text, changed });
  };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      push(left, a[i++], false);
      push(right, b[j++], false);
    } else if (j < b.length && (i === a.length || lcs[i][j + 1] >= lcs[i + 1][j])) {
      push(right, b[j++], true);
    } else {
      push(left, a[i++], true);
    }
  }
  return { before: left, after: right };
}
