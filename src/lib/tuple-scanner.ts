// One scanner for Unreal option-tuple text: double-quoted strings, backslash escapes inside them,
// and parenthesis depth. Shared by the INI layer and the per-setting validators.
export interface TupleScan {
  /** A double-quoted string was still open at the end. */
  quoted: boolean;
  /** The text ended on a backslash inside a string. */
  escaped: boolean;
  /** Final parenthesis depth. */
  depth: number;
  /** A closing parenthesis appeared without a matching opener. */
  negative: boolean;
  /** Index of the first ')' that returned the depth to zero, or null. */
  closedAt: number | null;
}

/** Scans `text`; `onTopLevelComma` sees each comma outside quotes at depth zero. */
export function scanTuple(text: string, onTopLevelComma?: (index: number) => void): TupleScan {
  let quoted = false; let escaped = false; let depth = 0; let negative = false; let closedAt: number | null = null;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (escaped) { escaped = false; continue; }
    if (character === "\\" && quoted) { escaped = true; continue; }
    if (character === '"') { quoted = !quoted; continue; }
    if (quoted) continue;
    if (character === "(") depth += 1;
    else if (character === ")") { depth -= 1; if (depth < 0) negative = true; else if (depth === 0 && closedAt === null) closedAt = index; }
    else if (character === "," && depth === 0) onTopLevelComma?.(index);
  }
  return { quoted, escaped, depth, negative, closedAt };
}
