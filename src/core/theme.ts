// Colour themes for the dashboard.
//
// Framework-free on purpose so the CLI can use the same semantic colours as the
// TUI without importing React. Roles are semantic — what a colour MEANS, not
// what it looks like — so a theme is just a palette mapping each role to a
// concrete colour.
//
// Foreground and accent colours only: a terminal UI cannot reliably paint a
// full-panel background, so (like btop) the terminal's own background is the
// canvas and themes work with whatever the user already has.

export interface Theme {
  /** Display name, and the key in both THEMES and config/ui.json. */
  name: string;
  /** Gains, up, buy, "on", success, filled, live. */
  positive: string;
  /** Losses, down, sell, errors, live mode, failed. */
  negative: string;
  /** Warnings, scanning, paper mode, hold, pending. */
  warning: string;
  /** Selection cursor, focused borders, highlighted row. */
  accent: string;
  /** Value highlights, input buffers, allocation bar fill. */
  info: string;
  /** Off states, below-threshold rows, secondary text. */
  muted: string;
  /**
   * When true, muted LABEL text uses the terminal's relative dim attribute
   * rather than an absolute colour. This is what lets the Default theme inherit
   * whatever palette the user's terminal already uses instead of fighting it.
   */
  mutedDim: boolean;
  /** Body foreground. Undefined means the terminal's own default. */
  text?: string;
  /** Panel borders. Undefined means the terminal's own default. */
  border?: string;
  /**
   * Vertical gradient stops for the filled equity chart, [bright, dark].
   * `up` when the curve trends up over the window, otherwise `down`. Always
   * hex, because these are interpolated.
   */
  graph: { up: [string, string]; down: [string, string] };
}

export const THEMES: Record<string, Theme> = {
  // Reproduces a plain ANSI palette exactly — inherits the user's terminal.
  Default: {
    name: "Default",
    positive: "green",
    negative: "red",
    warning: "yellow",
    accent: "cyan",
    info: "cyan",
    muted: "gray",
    mutedDim: true,
    graph: { up: ["#4ade80", "#0f3d24"], down: ["#f87171", "#3d1414"] },
  },
  Dracula: {
    name: "Dracula",
    positive: "#50fa7b",
    negative: "#ff5555",
    warning: "#f1fa8c",
    accent: "#bd93f9",
    info: "#8be9fd",
    muted: "#6272a4",
    mutedDim: false,
    text: "#f8f8f2",
    border: "#44475a",
    graph: { up: ["#50fa7b", "#1d3b4d"], down: ["#ff5555", "#3d2233"] },
  },
  Nord: {
    name: "Nord",
    positive: "#a3be8c",
    negative: "#bf616a",
    warning: "#ebcb8b",
    accent: "#88c0d0",
    info: "#8fbcbb",
    muted: "#4c566a",
    mutedDim: false,
    text: "#eceff4",
    border: "#434c5e",
    graph: { up: ["#a3be8c", "#2e3440"], down: ["#bf616a", "#2e3440"] },
  },
  Gruvbox: {
    name: "Gruvbox",
    positive: "#b8bb26",
    negative: "#fb4934",
    warning: "#fabd2f",
    accent: "#83a598",
    info: "#8ec07c",
    muted: "#928374",
    mutedDim: false,
    text: "#ebdbb2",
    border: "#504945",
    graph: { up: ["#b8bb26", "#32302f"], down: ["#fb4934", "#32302f"] },
  },
};

/** Order shown in the picker; Default last so themed options lead. */
export const THEME_ORDER = ["Dracula", "Nord", "Gruvbox", "Default"] as const;

export const DEFAULT_THEME = "Default";

export function getTheme(name: string): Theme {
  return THEMES[name] ?? THEMES[DEFAULT_THEME]!;
}

// ── Semantic helpers ────────────────────────────────────────────────────────
// Centralized so the "is it positive or negative" ternary is written once
// rather than in every component that displays a number.

export function plColor(t: Theme, n: number): string {
  return n >= 0 ? t.positive : t.negative;
}

export function actionColor(t: Theme, action: string): string {
  const a = action.toLowerCase();
  if (a === "buy") return t.positive;
  if (a.includes("sell") || a.includes("trim")) return t.negative;
  return t.warning;
}

/** Confidence 0–10 → colour band. */
export function confColor(t: Theme, c: number): string {
  if (c >= 7) return t.positive;
  if (c >= 4) return t.warning;
  return t.negative;
}

export function statusColor(t: Theme, status: string): string {
  const s = status.toLowerCase();
  if (s === "filled") return t.positive;
  if (s.includes("cancel") || s.includes("reject") || s.includes("expired")) return t.negative;
  return t.warning;
}

export function streamColor(t: Theme, s: string): string {
  if (s === "live") return t.positive;
  if (s === "limited") return t.negative;
  if (s === "closed") return t.muted;
  return t.warning; // connecting, reconnecting
}

/**
 * Props for muted LABEL text. Spread onto a Text element.
 *
 * Default uses the terminal's relative dim; the explicit themes use their own
 * muted colour. Returning props rather than a colour is what lets one call site
 * serve both without a conditional at every usage.
 */
export function mutedProps(t: Theme): { dimColor: true } | { color: string } {
  return t.mutedDim ? { dimColor: true } : { color: t.muted };
}
