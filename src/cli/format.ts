// Terminal output: colour, money, and aligned tables.
//
// The bash scripts got their alignment from python's format specifiers. This is
// the replacement, with one thing they could not do: measure width AFTER
// stripping ANSI escapes, so a coloured cell still lines up. Colouring a column
// used to silently break every column to its right.

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
} as const;

/**
 * Should we emit colour?
 *
 * Honours NO_COLOR (the de facto standard) and skips colour when stdout is a
 * pipe, so `toreda portfolio > file` produces clean text rather than escape
 * codes. FORCE_COLOR overrides both, which is what makes piping to `less -R`
 * work.
 */
function colorEnabled(): boolean {
  if (process.env.FORCE_COLOR) return true;
  if (process.env.NO_COLOR !== undefined) return false;
  return process.stdout.isTTY === true;
}

function wrap(code: string, text: string): string {
  return colorEnabled() ? `${code}${text}${ANSI.reset}` : text;
}

export const c = {
  bold: (s: string) => wrap(ANSI.bold, s),
  dim: (s: string) => wrap(ANSI.dim, s),
  red: (s: string) => wrap(ANSI.red, s),
  green: (s: string) => wrap(ANSI.green, s),
  yellow: (s: string) => wrap(ANSI.yellow, s),
  blue: (s: string) => wrap(ANSI.blue, s),
  magenta: (s: string) => wrap(ANSI.magenta, s),
  cyan: (s: string) => wrap(ANSI.cyan, s),
  gray: (s: string) => wrap(ANSI.gray, s),
};

/** Gains green, losses red. The single most repeated decision in this CLI. */
export function pl(n: number, text?: string): string {
  const s = text ?? String(n);
  return n >= 0 ? c.green(s) : c.red(s);
}

const NAMED: Record<string, string> = {
  green: ANSI.green,
  red: ANSI.red,
  yellow: ANSI.yellow,
  blue: ANSI.blue,
  magenta: ANSI.magenta,
  cyan: ANSI.cyan,
  gray: ANSI.gray,
};

/**
 * Paint text in an arbitrary theme colour — a `#rrggbb` hex or an ANSI name.
 *
 * Themes store concrete colours, so previewing one honestly means rendering ITS
 * palette rather than an approximation in the terminal's fixed sixteen. Falls
 * back to the plain string when colour is disabled or the value is unparseable.
 */
export function themed(color: string | undefined, text: string): string {
  if (!color || !colorEnabled()) return text;
  const named = NAMED[color];
  if (named) return `${named}${text}${ANSI.reset}`;
  const match = /^#?([0-9a-f]{6})$/i.exec(color);
  if (!match) return text;
  const value = parseInt(match[1]!, 16);
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  return `\x1b[38;2;${r};${g};${b}m${text}${ANSI.reset}`;
}

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

/** Visible width, ignoring colour escapes. */
export function visibleWidth(s: string): number {
  return s.replace(ANSI_PATTERN, "").length;
}

export function padEnd(s: string, width: number): string {
  return s + " ".repeat(Math.max(0, width - visibleWidth(s)));
}

export function padStart(s: string, width: number): string {
  return " ".repeat(Math.max(0, width - visibleWidth(s))) + s;
}

// ── Numbers ─────────────────────────────────────────────────────────────────

export function usd(n: number, decimals = 2): string {
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

/** Money with an explicit sign — for changes, where direction is the point. */
export function usdSigned(n: number, decimals = 2): string {
  const sign = n >= 0 ? "+" : "-";
  return `${sign}${usd(Math.abs(n), decimals)}`;
}

export function pct(fraction: number, decimals = 2): string {
  const sign = fraction >= 0 ? "+" : "";
  return `${sign}${(fraction * 100).toFixed(decimals)}%`;
}

/** Already-percent values, e.g. 5.2 meaning 5.2%. */
export function pctRaw(value: number, decimals = 2): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(decimals)}%`;
}

/** Share counts: drop trailing zeros so 0.377 and 5 both read naturally. */
export function qty(n: number): string {
  return String(Number(n.toFixed(9)));
}

export function compactMoney(n: number): string {
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

// ── Tables ──────────────────────────────────────────────────────────────────

export interface Column {
  header: string;
  align?: "left" | "right";
  /** Minimum width; the column grows to fit its widest cell regardless. */
  min?: number;
}

/**
 * Render an aligned table.
 *
 * Columns size to their content, so a $1,234,567.89 portfolio does not shove
 * the P&L column off the edge the way a hard-coded width would.
 */
export function table(columns: Column[], rows: string[][], gap = 2): string {
  const widths = columns.map((col, i) => {
    const cells = rows.map((r) => visibleWidth(r[i] ?? ""));
    return Math.max(visibleWidth(col.header), col.min ?? 0, ...cells, 0);
  });

  const spacer = " ".repeat(gap);
  const render = (cells: string[]): string =>
    columns
      .map((col, i) => {
        const cell = cells[i] ?? "";
        const w = widths[i] ?? 0;
        return col.align === "right" ? padStart(cell, w) : padEnd(cell, w);
      })
      .join(spacer)
      .trimEnd();

  const header = c.dim(render(columns.map((col) => col.header)));
  const rule = c.dim("─".repeat(widths.reduce((a, b) => a + b, 0) + gap * (columns.length - 1)));
  return [header, rule, ...rows.map(render)].join("\n");
}

// ── Structure ───────────────────────────────────────────────────────────────

export function heading(text: string): string {
  return `\n${c.bold(text)}`;
}

export function out(...lines: string[]): void {
  process.stdout.write(lines.join("\n") + "\n");
}

export function err(...lines: string[]): void {
  process.stderr.write(lines.join("\n") + "\n");
}

/** Failure notice. Reserved for things the user must act on. */
export function fail(message: string): void {
  err(`\n  ${c.red("✗")} ${message}\n`);
}

export function warn(message: string): void {
  out(`  ${c.yellow("⚠")} ${message}`);
}

export function ok(message: string): void {
  out(`  ${c.green("✓")} ${message}`);
}
