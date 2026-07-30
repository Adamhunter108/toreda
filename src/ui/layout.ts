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
