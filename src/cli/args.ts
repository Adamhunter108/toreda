// Argument parsing for the `toreda` command.
//
// Deliberately tiny and dependency-free. A trading CLI's argument handling is
// safety-relevant — `order NVDA buy 5 --confirm` transmits real money — so it
// should be something you can read end to end in one sitting rather than a
// library whose coercion rules you have to trust.

export interface ParsedArgs {
  /** First non-flag token, e.g. "order". Null when nothing was given. */
  command: string | null;
  /** Remaining non-flag tokens, in order, after the command. */
  positionals: string[];
  /** Flags by name, without leading dashes. */
  flags: Record<string, string | boolean>;
}

export interface ParseOptions {
  /**
   * Flags that consume the following token as their value (`--out report.txt`).
   * Anything not listed is boolean unless written as `--flag=value`.
   *
   * Declaring these explicitly is what stops `--confirm NVDA` from silently
   * swallowing the symbol and leaving `--confirm` looking unset.
   */
  valueFlags?: readonly string[];
}

/** Expand bundled short flags: `-abc` → `-a -b -c`. `-h` passes through. */
function expandShortFlags(token: string): string[] {
  return token.slice(1).split("").map((c) => `-${c}`);
}

export function parseArgs(argv: readonly string[], opts: ParseOptions = {}): ParsedArgs {
  const valueFlags = new Set(opts.valueFlags ?? []);
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};

  // Everything after a bare `--` is positional, never a flag. Lets a symbol or
  // filename that begins with a dash through unmolested.
  const tokens: string[] = [];
  let passthroughFrom = -1;
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i]!;
    if (tok === "--") {
      passthroughFrom = i + 1;
      break;
    }
    // Bundled shorts, but not a lone "-" and not a negative number, which is a
    // legitimate value for thresholds like a -7% stop loss.
    if (/^-[A-Za-z]{2,}$/.test(tok)) tokens.push(...expandShortFlags(tok));
    else tokens.push(tok);
  }
  const passthrough = passthroughFrom >= 0 ? argv.slice(passthroughFrom) : [];

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;

    if (!tok.startsWith("-") || tok === "-" || /^-\d/.test(tok)) {
      positionals.push(tok);
      continue;
    }

    const body = tok.replace(/^--?/, "");
    const eq = body.indexOf("=");
    if (eq !== -1) {
      flags[body.slice(0, eq)] = body.slice(eq + 1);
      continue;
    }

    const next = tokens[i + 1];
    if (valueFlags.has(body) && next !== undefined && !next.startsWith("-")) {
      flags[body] = next;
      i++;
      continue;
    }
    flags[body] = true;
  }

  positionals.push(...passthrough);
  const command = positionals.length > 0 ? positionals[0]! : null;
  return { command, positionals: positionals.slice(1), flags };
}

/** True when a flag was passed at all, in any form. */
export function hasFlag(args: ParsedArgs, ...names: string[]): boolean {
  return names.some((n) => args.flags[n] !== undefined && args.flags[n] !== false);
}

/** A flag's string value, or undefined if absent or passed as a bare boolean. */
export function flagValue(args: ParsedArgs, ...names: string[]): string | undefined {
  for (const n of names) {
    const v = args.flags[n];
    if (typeof v === "string") return v;
  }
  return undefined;
}
