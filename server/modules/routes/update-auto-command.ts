export type ParsedRestartCommand = { cmd: string; args: string[] };

const SHELL_META = /[;&|`$<>]/;

function unquote(token: string): string {
  const first = token[0];
  const last = token[token.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    const quote = first;
    const inner = token.slice(1, -1);
    // Only unescape the matching quote and backslash.
    // Other escape sequences are intentionally preserved literally (shell parsing is disabled).
    return inner.replace(/\\(.)/g, (match, ch: string) => {
      if (ch === quote || ch === "\\") return ch;
      return match;
    });
  }
  return token;
}

export function parseSafeRestartCommand(raw: string): ParsedRestartCommand | null {
  const input = String(raw ?? "").trim();
  if (!input) return null;

  // Tokenize first, then validate metacharacters on the unquoted command/args.
  const tokens = input.match(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\S+/g);
  if (!tokens || tokens.length === 0) return null;

  const parts = tokens.map((t) => unquote(t).trim()).filter(Boolean);
  if (parts.length === 0) return null;

  const [cmd, ...args] = parts;
  if (!cmd || SHELL_META.test(cmd)) return null;
  if (args.some((a) => SHELL_META.test(a))) return null;

  return { cmd, args };
}
