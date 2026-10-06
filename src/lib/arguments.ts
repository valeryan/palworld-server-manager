/** Windows command-line quoting: backslashes are literal except immediately before a double quote. No shell. */
export function windowsArguments(value: string): string[] {
  if (value.includes("\0")) throw new Error("Launch arguments cannot contain NUL bytes.");
  const args: string[] = []; let token = ""; let quoted = false; let present = false;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!;
    if (ch === "\\") {
      let count = 1; while (value[i + 1] === "\\") { count++; i++; }
      if (value[i + 1] === '\"') {
        token += "\\".repeat(Math.floor(count / 2)); i++;
        if (count % 2) token += '\"'; else quoted = !quoted;
      } else token += "\\".repeat(count);
      present = true;
    } else if (ch === '\"') { quoted = !quoted; present = true; }
    else if (/\s/.test(ch) && !quoted) { if (present) args.push(token); token = ""; present = false; }
    else { token += ch; present = true; }
  }
  if (quoted) throw new Error("Launch arguments contain an unfinished quote.");
  if (present) args.push(token);
  return args;
}

/**
 * POSIX-style tokenizer with single and double quotes and backslash escapes. No shell is involved.
 * With `escapeInSingleQuotes` a backslash escapes inside single quotes too (the historical manager
 * behaviour for Electron launch flags); without it, single quotes are literal, as in sh.
 */
export function posixArguments(value: string, options: { escapeInSingleQuotes?: boolean; unfinishedMessage?: string } = {}): string[] {
  const args: string[] = [];
  let token = ""; let quote: "'" | '"' | null = null; let escaped = false;
  for (const character of value.trim()) {
    if (escaped) { token += character; escaped = false; continue; }
    if (character === "\\" && (quote !== "'" || options.escapeInSingleQuotes)) { escaped = true; continue; }
    if (quote) { if (character === quote) quote = null; else token += character; continue; }
    if (character === "'" || character === '"') { quote = character; continue; }
    if (/\s/.test(character)) { if (token) { args.push(token); token = ""; } continue; }
    token += character;
  }
  if (escaped || quote) throw new Error(options.unfinishedMessage ?? "Arguments contain an unfinished quote or escape.");
  if (token) args.push(token);
  return args;
}
