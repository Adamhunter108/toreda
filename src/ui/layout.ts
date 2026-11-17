// Layout arithmetic for the dashboard.
//
// Pulled out of App so it can be tested directly. The rule these constants
// enforce: Ink squeezes an overflowing row by DROPPING CHARACTERS, so a row that
// does not fit does not wrap or scroll — it silently renders `$3752.75` as
// `$3752.7` and `11` shares as `1`. Both remain plausible numbers, which is what
// makes the failure dangerous rather than merely ugly.
//
// So every optional element has to earn its width before it is shown.
//
// Heights have the mirror-image problem: a frame taller than the terminal makes
// Ink clear and redraw the whole screen on every price tick, and the top of the
// dashboard — the header, the rule breaches — scrolls out of view. So every
// panel that can grow with your data has to fit a row budget too, and the
// budget is spent in order of importance: positions first.

/** Cursor, symbol, shares, value, day, P&L, P&L%, and the live-tick dot. */
export const POSITION_ROW_WIDTH = 61;

/** The weight column: share of the portfolio, the thing a ceiling is checked against. */
export const WEIGHT_WIDTH = 7;

/** Two spaces plus the allocation bar, which marks the position's ceiling. */
export const ALLOC_BAR_CELLS = 10;
export const ALLOC_WIDTH = 2 + ALLOC_BAR_CELLS;

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

export interface PositionColumns {
  /** Show the weight column. */
  weight: boolean;
  /** Sparkline width; 0 means none. */
  spark: number;
  /** Show the allocation bar beside the weight. */
  alloc: boolean;
}

/**
 * Which optional columns fit in a positions panel this wide.
 *
 * Earned in order: weight first (it carries a rule), then the trend sparkline
 * (the only column with information found nowhere else), then the allocation
 * bar (a picture of the weight, with the ceiling marked on it).
 */
export function positionColumns(panelWidth: number, sparkMax = SPARK_WIDTH - 2): PositionColumns {
  const none = { weight: false, spark: 0, alloc: false };
  if (panelWidth < POSITION_ROW_WIDTH + WEIGHT_WIDTH) return none;
  const room = panelWidth - POSITION_ROW_WIDTH - WEIGHT_WIDTH;
  if (room < SPARK_WIDTH) return { ...none, weight: true };
  const alloc = room >= SPARK_WIDTH + ALLOC_WIDTH;
  const sparkRoom = room - 2 - (alloc ? ALLOC_WIDTH : 0); // 2 = separator
  return { weight: true, alloc, spark: Math.min(sparkMax, sparkRoom) };
}

/** Rendered width of a positions row with these columns. */
export function positionRowWidth(c: PositionColumns): number {
  return (
    POSITION_ROW_WIDTH +
    (c.weight ? WEIGHT_WIDTH : 0) +
    (c.alloc ? ALLOC_WIDTH : 0) +
    (c.spark ? c.spark + 2 : 0)
  );
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
  return positionColumns(positionsPanelWidth(cols)).spark > 0;
}

// ── Zoomed sections ─────────────────────────────────────────────────────────
//
// Space expands the focused section to the whole terminal. Same rule as the
// grid: extra room goes to the optional elements only after the numbers fit.

/** Widest the zoomed sparkline grows: ~45 calendar days is ~30 sessions. */
export const ZOOM_SPARK_MAX = 32;

/** Columns for the zoomed positions panel, which has the whole terminal. */
export function zoomedPositionColumns(cols: number): PositionColumns {
  return positionColumns(cols - PANEL_CHROME, ZOOM_SPARK_MAX);
}

/** Sparkline width when zoomed. 0 means there is no room for one. */
export function zoomedSparkWidth(cols: number): number {
  return zoomedPositionColumns(cols).spark;
}

/**
 * Header box (3), stat bar, status bar — and headroom. Ink redraws the whole
 * screen once the frame reaches the terminal's height, so it must stay below
 * it; one spare row covers that, plus one for any line a panel wraps.
 */
export const ZOOM_CHROME_ROWS = 7;

/**
 * Rows the panels may occupy, after the chrome and any full-width lines
 * (banners, the rules strip). The floor keeps a tiny terminal legible.
 */
export function contentRows(termRows: number, extraLines: number, floor = 16): number {
  return Math.max(floor, termRows - ZOOM_CHROME_ROWS - extraLines);
}

/** Rows a zoomed panel may occupy. */
export function zoomedPanelRows(termRows: number, extraLines: number): number {
  return contentRows(termRows, extraLines, 10);
}

// ── Row budgets ─────────────────────────────────────────────────────────────

/** Rendered height of the positions panel showing `shown` of `total` rows. */
export function positionsHeight(shown: number, total: number): number {
  if (total === 0) return 4; // border, title, "No open positions."
  // Border, title, column header, rows, and a scroll line when windowed.
  return shown + 4 + (shown < total ? 1 : 0);
}

/**
 * The most position rows that fit `budget`. Never fewer than one: a panel that
 * hides every position to save space is worse than one that overflows.
 */
export function fitPositions(total: number, budget: number): number {
  if (total === 0) return 0;
  for (let r = total; r > 1; r--) if (positionsHeight(r, total) <= budget) return r;
  return 1;
}

/** The equity chart's preferred rows in the wide layout. */
export const CHART_MIN = 8;
/** The least the chart shrinks to, in either layout, before positions scroll. */
export const CHART_FLOOR = 4;
/** Chart rows in the single-column layout. */
export const NARROW_CHART_ROWS = 6;
/** Fewest watchlist rows worth showing. */
export const WATCH_MIN = 3;
/** Watchlist rows in the single-column layout when there is room. */
export const NARROW_WATCH_ROWS = 8;
/** Movers shown in the wide layout's watchlist before it flexes to fill. */
export const WIDE_WATCH_BASE = 8;
/** Signals the compact panel lists when there is room, and the least it shrinks to. */
export const SIG_ROWS = 6;
export const SIG_MIN = 2;

/** Rendered height of the signals panel listing `rows` of `n` signals (0 = a status line). */
export function signalsHeight(rows: number, n: number): number {
  return n > 0 ? Math.min(n, rows) + 5 : 4; // border, title, two more-lines
}

export interface GridPlan {
  /** Position rows shown; the panel scrolls with the cursor beyond these. */
  posRows: number;
  chartRows: number;
  /** Watchlist rows; 0 while there are no movers yet. */
  watchRows: number;
  /** Signals listed in the compact panel. */
  signalRows: number;
}

/**
 * Size every panel in the main grid to fit `contentH` rows.
 *
 * Positions are the primary view, so they are sized first: every other panel
 * is counted at its minimum, positions take what they need, and only the rows
 * left over are handed back. Positions scroll only when the others are already
 * as small as they go.
 *
 * Wide: two columns balanced to a common height; the chart and the watchlist
 * are the flexible panels that grow to meet it, so neither column ends short.
 * Narrow: one stack. Spare rows go back to the chart first, then signals, then
 * the watchlist.
 */
export function planGrid(opts: {
  wide: boolean;
  nPos: number;
  nMovers: number;
  /** Signals the panel has to list; 0 while it shows a one-line status. */
  nSignals: number;
  contentH: number;
}): GridPlan {
  const { wide, nPos, nMovers, nSignals, contentH } = opts;
  const watchH = (rows: number): number => (nMovers ? rows + 5 : 4);
  const sigH = (rows: number): number => signalsHeight(rows, nSignals);

  if (wide) {
    const posRows = fitPositions(nPos, contentH - (CHART_FLOOR + 3));
    const posH = positionsHeight(posRows, nPos);
    const leftBase = posH + CHART_MIN + 3;
    const rightBase = watchH(Math.min(nMovers, WIDE_WATCH_BASE)) + sigH(SIG_ROWS);
    const target = Math.min(contentH, Math.max(leftBase, rightBase));
    // Signals shrink only once the watchlist is at its minimum.
    const signalRows = Math.max(SIG_MIN, Math.min(SIG_ROWS, target - watchH(WATCH_MIN) - 5));
    return {
      posRows,
      chartRows: Math.max(CHART_FLOOR, target - posH - 3),
      watchRows: nMovers
        ? Math.max(WATCH_MIN, Math.min(nMovers, target - sigH(signalRows) - 5))
        : 0,
      signalRows,
    };
  }

  const minOthers = CHART_FLOOR + 3 + watchH(WATCH_MIN) + sigH(SIG_MIN);
  const posRows = fitPositions(nPos, contentH - minOthers);
  let spare = contentH - positionsHeight(posRows, nPos) - minOthers;
  const grow = (from: number, to: number): number => {
    const g = Math.max(0, Math.min(to - from, spare));
    spare -= g;
    return from + g;
  };
  const chartRows = grow(CHART_FLOOR, NARROW_CHART_ROWS);
  const signalRows = grow(SIG_MIN, Math.max(SIG_MIN, Math.min(SIG_ROWS, nSignals)));
  const watchRows = nMovers ? grow(WATCH_MIN, Math.max(WATCH_MIN, Math.min(nMovers, NARROW_WATCH_ROWS))) : 0;
  return { posRows, chartRows, watchRows, signalRows };
}

/** Height the rules strip takes: one line, or one per breach up to a cap. */
export const STRIP_MAX_ALERTS = 3;
export function rulesStripHeight(alerts: number | null): number {
  if (alerts === null || alerts === 0) return 1;
  return Math.min(alerts, STRIP_MAX_ALERTS) + (alerts > STRIP_MAX_ALERTS ? 1 : 0);
}
