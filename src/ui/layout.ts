// Layout arithmetic for the dashboard.
//
// Pulled out of App so it can be tested directly. The rule these constants
// enforce: Ink squeezes an overflowing row by DROPPING CHARACTERS, so a row that
// does not fit does not wrap or scroll — it silently renders `$3752.75` as
// `$3752.7` and `11` shares as `1`. Both remain plausible numbers, which is what
// makes the failure dangerous rather than merely ugly.
//
// So every optional element has to earn its width before it is shown.

/** Cursor, symbol, shares, value, day, P&L, P&L%, and the live-tick dot. */
export const POSITION_ROW_WIDTH = 61;

/** Two spaces of separation plus a 16-character sparkline. */
export const SPARK_WIDTH = 18;

/** Border on both sides, plus paddingX on both sides. */
export const PANEL_CHROME = 4;

/** Terminal width at which the layout switches to two columns. */
export const WIDE_THRESHOLD = 100;

/** Width reserved for the right-hand column, plus its margin. */
export const RIGHT_COLUMN_WIDTH = 35;

export function isWide(cols: number): boolean {
  return cols >= WIDE_THRESHOLD;
}

/** Usable width inside the positions panel, after chrome and any right column. */
export function positionsPanelWidth(cols: number): number {
  const outer = isWide(cols) ? Math.max(0, cols - RIGHT_COLUMN_WIDTH) : cols;
  return outer - PANEL_CHROME;
}

/**
 * Is there genuinely room for the sparkline?
 *
 * Deliberately NOT the same question as "is the terminal wide". At 110 columns
 * the terminal is wide, the two-column layout is correct, and the sparkline
 * still does not fit — which is exactly the band where the numbers were being
 * quietly truncated.
 */
export function shouldShowSparkline(cols: number): boolean {
  return positionsPanelWidth(cols) >= POSITION_ROW_WIDTH + SPARK_WIDTH;
}

// ── Zoomed sections ─────────────────────────────────────────────────────────
//
// Space expands the focused section to the whole terminal. Same rule as the
// grid: extra room goes to the optional elements only after the numbers fit.

/** Widest the zoomed sparkline grows: ~45 calendar days is ~30 sessions. */
export const ZOOM_SPARK_MAX = 32;

/**
 * Sparkline width for the zoomed positions panel, which has the whole
 * terminal. 0 means there is no room for one at the grid's minimum width.
 */
export function zoomedSparkWidth(cols: number): number {
  const room = cols - PANEL_CHROME - POSITION_ROW_WIDTH - 2; // 2 = separator
  if (room < SPARK_WIDTH - 2) return 0;
  return Math.min(ZOOM_SPARK_MAX, room);
}

/** Header box (3), stat bar, status bar, and headroom so Ink never scrolls. */
export const ZOOM_CHROME_ROWS = 8;

/** Rows a zoomed panel may occupy, after the chrome and any banners. */
export function zoomedPanelRows(termRows: number, banners: number): number {
  return Math.max(10, termRows - ZOOM_CHROME_ROWS - banners);
}
