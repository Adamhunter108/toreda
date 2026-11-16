import * as React from "react";
import { useMemo, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import { loadConfig } from "../core/config";
import { isDemoMode } from "../core/demo";
import { loadRiskRules } from "../core/risk";
import { mutedProps } from "../core/theme";
import type { Position } from "../core/types";
import { loadWatchlistSectors, loadWatchlistSymbols } from "../core/watchlist";
import { AllocationBar } from "./components/AllocationBar";
import { DetailPane } from "./components/DetailPane";
import { EquityChart } from "./components/EquityChart";
import { Header } from "./components/Header";
import { OrderHistory } from "./components/OrderHistory";
import { OrderTicket } from "./components/OrderTicket";
import { Positions } from "./components/Positions";
import { ScannerSettings } from "./components/ScannerSettings";
import { SignalsPanel } from "./components/SignalsPanel";
import { SignalsView } from "./components/SignalsView";
import { StatBar } from "./components/StatBar";
import { StatusBar } from "./components/StatusBar";
import { ThemePicker } from "./components/ThemePicker";
import { Watchlist } from "./components/Watchlist";
import { WatchlistManager } from "./components/WatchlistManager";
import { useAlpaca } from "./hooks/useAlpaca";
import {
  useClock,
  useCloses,
  useEquityHistory,
  useRealized,
  useSnapshots,
  useSymbolStats,
} from "./hooks/useMarketData";
import { usePrices } from "./hooks/usePrices";
import { useScanner } from "./hooks/useScanner";
import { useScannerConfig } from "./hooks/useScannerConfig";
import { shouldShowSparkline, zoomedPanelRows, zoomedSparkWidth } from "./layout";
import { useTheme } from "./theme/ThemeContext";

/** Equity chart periods cycled with `p` — [Alpaca period, label, timeframe]. */
const PERIODS: ReadonlyArray<readonly [string, string, string]> = [
  ["1D", "1 day", "5Min"],
  ["1M", "1 month", "1D"],
  ["3M", "3 months", "1D"],
  ["1A", "1 year", "1D"],
];

/** Position sort orders cycled with `s`. */
const SORTS = [
  ["value", "value"],
  ["pl", "P&L"],
  ["day", "day move"],
  ["symbol", "A–Z"],
] as const;

/**
 * The focusable sections, in Tab order. Space expands the focused one to full
 * screen. The chart comes last so the original three keep their order.
 */
const SECTIONS = ["positions", "watchlist", "signals", "chart"] as const;
type Section = (typeof SECTIONS)[number];

function sortPositions(positions: Position[], key: string): Position[] {
  const arr = [...positions];
  arr.sort((a, b) => {
    if (key === "symbol") return a.symbol.localeCompare(b.symbol);
    if (key === "pl") return b.unrealizedPl - a.unrealizedPl;
    if (key === "day") return b.changeToday - a.changeToday;
    return b.marketValue - a.marketValue;
  });
  return arr;
}

export function App() {
  const t = useTheme();
  const { account, positions: rawPositions, error, updatedAt } = useAlpaca(20_000);
  const symbols = rawPositions.map((p) => p.symbol);
  const { prices, status } = usePrices(symbols);

  const [periodIdx, setPeriodIdx] = useState(1); // default 1M
  const [period, periodLabel, timeframe] = PERIODS[periodIdx] ?? PERIODS[1]!;
  const equity = useEquityHistory(period, timeframe);
  const closes = useCloses(symbols);

  const [wlVersion, setWlVersion] = useState(0);
  const watchlist = useMemo(() => loadWatchlistSymbols(), [wlVersion]);
  const sectors = useMemo(() => loadWatchlistSectors(), [wlVersion]);
  const movers = useSnapshots(watchlist);
  const marketOpen = useClock();
  const realized = useRealized();
  const scan = useScanner();
  const { config: scannerConfig, update: updateScanner } = useScannerConfig();
  const risk = useMemo(() => loadRiskRules(), []);
  const tradeMode = useMemo(() => loadConfig().mode, []);

  const [sortIdx, setSortIdx] = useState(0);
  const [sortKey, sortLabel] = SORTS[sortIdx] ?? SORTS[0];
  const positions = useMemo(() => sortPositions(rawPositions, sortKey), [rawPositions, sortKey]);

  const { stdout } = useStdout();
  // DASH_COLS overrides width detection, so the smoke test can exercise the
  // wide layout in a non-TTY where real columns are not reported.
  const cols = Number(process.env.DASH_COLS) || stdout?.columns || 80;
  const wide = cols >= 100;
  const chartCols = wide ? cols - 36 : cols;

  const { exit } = useApp();
  const isTTY = process.stdin.isTTY === true;
  const [selected, setSelected] = useState(0);
  // DASH_ZOOM=<section> starts with that section focused and expanded.
  const envZoom = SECTIONS.find((s) => s === process.env.DASH_ZOOM);
  const [focus, setFocus] = useState<Section>(envZoom ?? "positions");
  // Zoom always applies to the focused section, and Tab is ignored while zoomed,
  // so a boolean is enough. Signals is the exception: its full-screen form is
  // the existing SignalsView, so zooming it sets `signalsOpen` instead.
  const [zoomed, setZoomed] = useState(envZoom !== undefined && envZoom !== "signals");
  const [wlCursor, setWlCursor] = useState(0);
  const [sigCursor, setSigCursor] = useState(0);
  const wlRows = wide ? 12 : 8;

  // Watchlist ranked by absolute move, so the cursor over it picks something
  // worth acting on rather than whatever happens to be alphabetically first.
  const sortedMovers = useMemo(
    () => [...movers].sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct)),
    [movers],
  );
  const sortedSignals = useMemo(() => {
    if (!scan.result) return [];
    return [...scan.result.opportunities].sort((a, b) => b.confidence - a.confidence);
  }, [scan.result]);

  const [detailOpen, setDetailOpen] = useState(process.env.DASH_DETAIL === "1");
  const [watchlistOpen, setWatchlistOpen] = useState(process.env.DASH_WATCHLIST === "1");
  const [signalsOpen, setSignalsOpen] = useState(
    process.env.DASH_SIGNALS === "1" || envZoom === "signals",
  );
  const [settingsOpen, setSettingsOpen] = useState(process.env.DASH_SETTINGS === "1");
  // Trading is OFF by default. Disarmed, `o` is inert.
  const [armed, setArmed] = useState(process.env.DASH_ARMED === "1");
  const [orderOpen, setOrderOpen] = useState(process.env.DASH_ORDER === "1");
  const [orderSymbol, setOrderSymbol] = useState(process.env.DASH_ORDER_SYMBOL ?? "");
  const [historyOpen, setHistoryOpen] = useState(process.env.DASH_HISTORY === "1");
  const [themeOpen, setThemeOpen] = useState(process.env.DASH_THEME_PICKER === "1");

  const sel = Math.min(selected, Math.max(0, positions.length - 1));
  const wlSel = Math.min(wlCursor, Math.max(0, sortedMovers.length - 1));
  const sigSel = Math.min(sigCursor, Math.max(0, sortedSignals.length - 1));

  const openOrder = (symbol: string): void => {
    if (!armed || !symbol) return;
    setOrderSymbol(symbol);
    setDetailOpen(false);
    setSignalsOpen(false);
    setOrderOpen(true);
  };

  const detailSymbol = detailOpen && positions[sel] ? positions[sel]!.symbol : null;
  const symbolStats = useSymbolStats(detailSymbol);

  useInput(
    (input, key) => {
      if (input === "q" || (key.ctrl && input === "c")) {
        exit();
        return;
      }
      if (detailOpen) {
        if (input === "o") {
          openOrder(positions[sel]?.symbol ?? "");
          return;
        }
        if (key.escape || key.return || input === " ") setDetailOpen(false);
        return;
      }
      // Space expands the focused section to full screen, and toggles back.
      // Enter stays the drill-in to a single position — space is the section,
      // enter is the row.
      if (input === " ") {
        if (focus === "signals") setSignalsOpen(true);
        else setZoomed((z) => !z);
        return;
      }
      if (zoomed && key.escape) {
        setZoomed(false);
        return;
      }
      if (key.tab && !zoomed) {
        setFocus((f) => SECTIONS[(SECTIONS.indexOf(f) + 1) % SECTIONS.length]!);
      }
      if (key.downArrow) {
        if (focus === "watchlist") setWlCursor((c) => Math.min(sortedMovers.length - 1, c + 1));
        else if (focus === "signals") setSigCursor((c) => Math.min(sortedSignals.length - 1, c + 1));
        else if (focus === "positions") setSelected((s) => Math.min(positions.length - 1, s + 1));
      }
      if (key.upArrow) {
        if (focus === "watchlist") setWlCursor((c) => Math.max(0, c - 1));
        else if (focus === "signals") setSigCursor((c) => Math.max(0, c - 1));
        else if (focus === "positions") setSelected((s) => Math.max(0, s - 1));
      }
      if (input === "p") setPeriodIdx((i) => (i + 1) % PERIODS.length);
      if (input === "s") {
        setSortIdx((i) => (i + 1) % SORTS.length);
        setSelected(0);
      }
      if (input === "w") setWatchlistOpen(true);
      if (input === "g") setSignalsOpen(true);
      if (input === "c") setSettingsOpen(true);
      if (input === "t") setThemeOpen(true);
      if (input === "r") scan.refresh();
      // Deliberately shift-A: arming enables the only write path in the UI, and
      // a lowercase key sits next to too many harmless ones.
      if (input === "A") setArmed((a) => !a);
      if (input === "o") {
        // The chart has no symbol, so `o` is inert there rather than quietly
        // ordering whichever position happens to be selected off-screen.
        const target =
          focus === "watchlist"
            ? sortedMovers[wlSel]?.symbol
            : focus === "signals"
              ? sortedSignals[sigSel]?.symbol
              : focus === "positions"
                ? positions[sel]?.symbol
                : undefined;
        openOrder(target ?? "");
      }
      if (input === "h") setHistoryOpen(true);
      if (input === "[")
        updateScanner((c) => ({ ...c, minConfidence: Math.max(1, c.minConfidence - 1) }));
      if (input === "]")
        updateScanner((c) => ({ ...c, minConfidence: Math.min(9, c.minConfidence + 1) }));
      if (key.return && focus === "positions" && positions.length > 0) {
        setDetailOpen(true);
      }
    },
    {
      isActive:
        isTTY &&
        !watchlistOpen &&
        !signalsOpen &&
        !settingsOpen &&
        !orderOpen &&
        !historyOpen &&
        !themeOpen,
    },
  );

  // "This operation was aborted" is opaque; translate it.
  const friendly = error && /abort|timed out/i.test(error) ? "timed out — network down?" : error;
  const hasData = account !== null || positions.length > 0;
  // Only take over the whole screen when there is nothing to show. Once data has
  // loaded, a transient error becomes a status-bar note and the last-known
  // dashboard stays up — a network blip should not blank everything.
  // Kept short deliberately: the status bar is one line, and a note long enough
  // to wrap pushes the whole frame down on every poll.
  const note =
    status === "limited"
      ? "stream limited — free tier allows 1"
      : error && hasData
        ? `reconnecting (${friendly})`
        : undefined;

  if (error && !hasData) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={t.border} paddingX={1}>
        <Text color={t.warning}>⚠ Can't reach Alpaca — {friendly}</Text>
        <Text {...mutedProps(t)}>Retrying every 20s… check your network, then `toreda doctor`.</Text>
      </Box>
    );
  }

  const headerBox = (
    <Box borderStyle="round" paddingX={1}>
      <Header account={account} marketOpen={marketOpen} />
    </Box>
  );
  const statBar = <StatBar positions={positions} prices={prices} realized={realized} />;

  const statusBar = (hint: string) => (
    <StatusBar
      stream={status}
      updatedAt={updatedAt}
      count={positions.length}
      hint={hint}
      note={note}
    />
  );

  // ── Full-screen views ─────────────────────────────────────────────────────

  if (detailOpen && positions[sel]) {
    const p = positions[sel]!;
    return (
      <Box flexDirection="column">
        {headerBox}
        {statBar}
        <DetailPane
          position={p}
          price={prices[p.symbol]}
          closes={closes[p.symbol] ?? []}
          stats={symbolStats}
          bookValue={account?.equity ?? 0}
          availCols={cols}
        />
        {statusBar(`esc/⏎ back${armed ? " · o order" : ""} · q quit`)}
      </Box>
    );
  }

  if (watchlistOpen) {
    return (
      <Box flexDirection="column">
        {headerBox}
        <WatchlistManager
          symbols={watchlist}
          onChange={() => setWlVersion((v) => v + 1)}
          onClose={() => setWatchlistOpen(false)}
        />
        {statusBar("editing watchlist")}
      </Box>
    );
  }

  if (signalsOpen) {
    return (
      <Box flexDirection="column">
        {headerBox}
        <SignalsView
          result={scan.result}
          scanning={scan.scanning}
          error={scan.error}
          lastRun={scan.lastRun}
          minConf={scannerConfig.minConfidence}
          armed={armed}
          cursor={sigSel}
          onCursor={setSigCursor}
          onOrder={openOrder}
          onRefresh={scan.refresh}
          onClose={() => setSignalsOpen(false)}
        />
        {statusBar(`↑↓ select${armed ? " · o order" : ""} · r rescan · space/esc back`)}
      </Box>
    );
  }

  if (settingsOpen) {
    return (
      <Box flexDirection="column">
        {headerBox}
        <ScannerSettings
          config={scannerConfig}
          sectors={sectors}
          update={updateScanner}
          onClose={() => setSettingsOpen(false)}
        />
        {statusBar("scanner settings · esc back")}
      </Box>
    );
  }

  if (orderOpen) {
    return (
      <Box flexDirection="column">
        {headerBox}
        <OrderTicket
          initialSymbol={orderSymbol || positions[sel]?.symbol || ""}
          positions={positions}
          prices={prices}
          account={account}
          risk={risk}
          mode={tradeMode}
          onClose={() => setOrderOpen(false)}
          onPlaced={() => {
            /* positions and account refresh on their own 20s poll */
          }}
        />
        {statusBar("order ticket · esc cancel")}
      </Box>
    );
  }

  if (historyOpen) {
    return (
      <Box flexDirection="column">
        {headerBox}
        <OrderHistory onClose={() => setHistoryOpen(false)} />
        {statusBar("order history · esc back")}
      </Box>
    );
  }

  if (themeOpen) {
    return (
      <Box flexDirection="column">
        {headerBox}
        <ThemePicker onClose={() => setThemeOpen(false)} />
        {statusBar("theme picker · esc back")}
      </Box>
    );
  }

  // ── Main grid ─────────────────────────────────────────────────────────────

  // Demo output must never be mistakable for a real account — in a screenshot,
  // in a screen share, or in somebody's memory of what they saw.
  const demoBanner = isDemoMode() ? (
    <Box paddingX={1}>
      <Text bold color={t.info}>
        ◆ DEMO
      </Text>
      <Text {...mutedProps(t)}> — fake data, no account connected, no orders possible</Text>
    </Box>
  ) : null;

  const armedBanner = armed ? (
    <Box paddingX={1}>
      <Text bold color={t.negative}>
        ● TRADING ARMED
      </Text>
      <Text {...mutedProps(t)}> — real orders enabled · o to place · A to disarm</Text>
    </Box>
  ) : null;

  // ── Zoomed section ────────────────────────────────────────────────────────
  //
  // The focused panel, given the whole terminal. Every key that works on it in
  // the grid still works here — this is the same section, bigger, not a new
  // screen. The banners stay: zoomed is still the live dashboard, and `o` still
  // reaches the order ticket from it.

  if (zoomed) {
    const banners = (demoBanner ? 1 : 0) + (armedBanner ? 1 : 0);
    const zoomRows = zoomedPanelRows(stdout?.rows ?? 40, banners);
    const back = "space/esc back · q quit";
    let panel: React.ReactNode;
    let hint: string;

    if (focus === "watchlist") {
      panel = (
        <Watchlist
          movers={sortedMovers}
          rows={Math.max(3, zoomRows - 5)} // border, title, and the two "more" lines
          cursor={wlSel}
          focused
        />
      );
      hint = `↑↓ select${armed ? " · o order" : ""} · ${back}`;
    } else if (focus === "chart") {
      panel = (
        <EquityChart
          equity={equity}
          availCols={cols}
          maxWidth={cols}
          periodLabel={periodLabel}
          height={zoomRows - 3} // border and title
          focused
        />
      );
      hint = `p period · ${back}`;
    } else {
      const sparkWidth = zoomedSparkWidth(cols);
      panel = (
        <Positions
          positions={positions}
          prices={prices}
          closes={closes}
          selected={sel}
          showSpark={sparkWidth > 0}
          sparkWidth={sparkWidth}
          sortLabel={sortLabel}
          focused
        />
      );
      hint = `↑↓ select · ⏎ detail · s sort${armed ? " · o order" : ""} · ${back}`;
    }

    return (
      <Box flexDirection="column">
        {headerBox}
        {statBar}
        {demoBanner}
        {armedBanner}
        {panel}
        {statusBar(hint)}
      </Box>
    );
  }

  // Show the sparkline only when the row genuinely fits — see src/ui/layout.ts
  // for why this is not the same question as "is the terminal wide".
  const showSpark = shouldShowSparkline(cols);

  const positionsPanel = (
    <Positions
      positions={positions}
      prices={prices}
      closes={closes}
      selected={sel}
      showSpark={showSpark}
      sortLabel={sortLabel}
      focused={focus === "positions"}
    />
  );
  const signalsPanel = (
    <SignalsPanel
      signals={sortedSignals}
      scanned={scan.result !== null}
      scanning={scan.scanning}
      error={scan.error}
      minConf={scannerConfig.minConfidence}
      focused={focus === "signals"}
      cursor={sigSel}
    />
  );

  // Balanced-fill layout (wide only): fill BOTH columns to a common target
  // height so neither has dead space. The taller column sets the target, then
  // the shorter one's flexible panel — the chart on the left, the watchlist on
  // the right — grows to meet it. Figures are rendered rows: border = 2,
  // title = 1, and so on.
  const nPos = positions.length;
  const positionsH = nPos ? nPos + 4 : 4;
  const allocH = nPos ? nPos + 4 : 5;
  const leftWidth = Math.max(0, cols - 35);
  // Pair Positions and Allocation side by side only when Positions keeps enough
  // width for its full row including the sparkline; otherwise stack them.
  const allocBeside = leftWidth >= 110;
  const topH = allocBeside ? Math.max(positionsH, allocH) : positionsH + allocH;

  const SIG_ROWS = 6; // mirrors SignalsPanel's internal window
  const signalsH =
    scan.result && sortedSignals.length ? Math.min(sortedSignals.length, SIG_ROWS) + 5 : 4;

  const CHART_MIN = 8; // floor so the chart stays legible when space is tight
  const haveMovers = sortedMovers.length > 0;
  const leftBase = topH + CHART_MIN + 3;
  const rightBase = (haveMovers ? Math.min(sortedMovers.length, 8) + 5 : 4) + signalsH;
  // Capped so a tall scan cannot push the frame past the terminal.
  const maxContentH = Math.max(16, (stdout?.rows ?? 40) - 8);
  const targetH = Math.min(maxContentH, Math.max(leftBase, rightBase));

  const chartRows = Math.max(CHART_MIN, targetH - topH - 3);
  const watchRows = haveMovers
    ? Math.max(3, Math.min(sortedMovers.length, targetH - signalsH - 5))
    : wlRows;

  const mainHint = wide
    ? `${armed ? "o order · " : ""}space zoom · A ${armed ? "disarm" : "arm"} · h history · g signals · c settings · w watchlist · t theme · q quit`
    : "A o h g c t · tab space q";

  return (
    <Box flexDirection="column">
      {headerBox}
      {statBar}
      {demoBanner}
      {armedBanner}

      {wide ? (
        <Box>
          <Box flexDirection="column" flexGrow={1} marginRight={1}>
            {allocBeside ? (
              <Box>
                {positionsPanel}
                <Box width={26} marginLeft={1}>
                  <AllocationBar positions={positions} prices={prices} barWidth={12} />
                </Box>
              </Box>
            ) : (
              <>
                {positionsPanel}
                <AllocationBar positions={positions} prices={prices} />
              </>
            )}
            <EquityChart
              equity={equity}
              availCols={chartCols}
              periodLabel={periodLabel}
              height={chartRows}
              focused={focus === "chart"}
            />
          </Box>
          <Box flexDirection="column" width={34}>
            <Watchlist
              movers={sortedMovers}
              rows={watchRows}
              cursor={wlSel}
              focused={focus === "watchlist"}
            />
            {signalsPanel}
          </Box>
        </Box>
      ) : (
        <Box flexDirection="column">
          {positionsPanel}
          <AllocationBar positions={positions} prices={prices} />
          <EquityChart
            equity={equity}
            availCols={chartCols}
            periodLabel={periodLabel}
            focused={focus === "chart"}
          />
          <Watchlist
            movers={sortedMovers}
            rows={wlRows}
            cursor={wlSel}
            focused={focus === "watchlist"}
          />
          {signalsPanel}
        </Box>
      )}

      {statusBar(mainHint)}
    </Box>
  );
}
