import * as React from "react";
import { useMemo, useState } from "react";
import { basename } from "node:path";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import { loadConfig } from "../core/config";
import { isDemoMode } from "../core/demo";
import { appendJournal, formatRulesEntry } from "../core/journal";
import { describeRuleChanges, type RiskRules } from "../core/risk";
import { mutedProps } from "../core/theme";
import { loadWatchlist } from "../core/watchlist";
import {
  bookAccountState,
  bookAlerts,
  bookExceptions,
  breachesBySymbol,
  markBook,
  sortBook,
} from "./book";
import { DetailPane } from "./components/DetailPane";
import { EquityChart } from "./components/EquityChart";
import { Header } from "./components/Header";
import { OrderHistory } from "./components/OrderHistory";
import { OrderTicket } from "./components/OrderTicket";
import { Positions } from "./components/Positions";
import { RiskRulesEditor, type SaveResult } from "./components/RiskRulesEditor";
import { RulesStrip } from "./components/RulesStrip";
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
import { useRiskRules } from "./hooks/useRiskRules";
import { useScanner } from "./hooks/useScanner";
import { useScannerConfig } from "./hooks/useScannerConfig";
import {
  contentRows,
  fitPositions,
  NARROW_WATCH_ROWS,
  planGrid,
  positionColumns,
  positionsPanelWidth,
  rulesStripHeight,
  zoomedPanelRows,
  zoomedPositionColumns,
} from "./layout";
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

export function App() {
  const t = useTheme();
  const {
    account,
    positions: rawPositions,
    flows,
    error,
    updatedAt,
    refresh: refreshAccount,
  } = useAlpaca(20_000);
  const symbols = rawPositions.map((p) => p.symbol);
  const { prices, status } = usePrices(symbols);

  const [periodIdx, setPeriodIdx] = useState(1); // default 1M
  const [period, periodLabel, timeframe] = PERIODS[periodIdx] ?? PERIODS[1]!;
  const history = useEquityHistory(period, timeframe);
  const closes = useCloses(symbols);

  const [wlVersion, setWlVersion] = useState(0);
  const wl = useMemo(() => loadWatchlist(), [wlVersion]);
  const movers = useSnapshots(wl.symbols);
  const marketOpen = useClock();
  const realized = useRealized();
  const scan = useScanner();
  const { config: scannerConfig, update: updateScanner } = useScannerConfig();
  const { rules: risk, reload: reloadRisk, save: saveRisk } = useRiskRules();
  const tradeMode = useMemo(() => loadConfig().mode, []);

  // ONE set of numbers for every panel — see ./book.ts for why.
  const book = useMemo(
    () => markBook(account, rawPositions, prices, risk, flows),
    [account, rawPositions, prices, risk, flows],
  );
  const alerts = useMemo(() => bookAlerts(book, risk), [book, risk]);
  const breaches = useMemo(() => breachesBySymbol(alerts), [alerts]);
  // Past the default stop but held under a dated exception: shown, not alerted.
  const excepted = useMemo(() => bookExceptions(book, risk), [book, risk]);
  const held = useMemo(() => new Set(rawPositions.map((p) => p.symbol)), [rawPositions]);

  const [sortIdx, setSortIdx] = useState(0);
  const [sortKey, sortLabel] = SORTS[sortIdx] ?? SORTS[0];
  const rows = useMemo(() => sortBook(book.rows, sortKey), [book.rows, sortKey]);

  const { stdout } = useStdout();
  // DASH_COLS overrides width detection, so the smoke test can exercise the
  // wide layout in a non-TTY where real columns are not reported.
  const cols = Number(process.env.DASH_COLS) || stdout?.columns || 80;
  const termRows = stdout?.rows ?? 40;
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
  const [rulesOpen, setRulesOpen] = useState(process.env.DASH_RULES === "1");
  // Trading is OFF by default. Disarmed, `o` is inert.
  const [armed, setArmed] = useState(process.env.DASH_ARMED === "1");
  const [orderOpen, setOrderOpen] = useState(process.env.DASH_ORDER === "1");
  const [orderSymbol, setOrderSymbol] = useState(process.env.DASH_ORDER_SYMBOL ?? "");
  const [historyOpen, setHistoryOpen] = useState(process.env.DASH_HISTORY === "1");
  const [themeOpen, setThemeOpen] = useState(process.env.DASH_THEME_PICKER === "1");

  const sel = Math.min(selected, Math.max(0, rows.length - 1));
  const wlSel = Math.min(wlCursor, Math.max(0, sortedMovers.length - 1));
  const sigSel = Math.min(sigCursor, Math.max(0, sortedSignals.length - 1));

  const openOrder = (symbol: string): void => {
    if (!armed || !symbol) return;
    setOrderSymbol(symbol);
    setDetailOpen(false);
    setSignalsOpen(false);
    setOrderOpen(true);
  };

  const openRules = (): void => {
    reloadRisk(); // never start an edit from a stale copy
    setRulesOpen(true);
  };

  const saveRules = (next: RiskRules, why: string, baseline: RiskRules): SaveResult => {
    const changes = describeRuleChanges(baseline, next);
    const saved = saveRisk(next, baseline);
    if (!saved.ok) return { ok: false, message: saved.error };
    // "A rule changed" is one of the journal entries the template asks for —
    // the decision, dated, with its reason, next to the trades it affects.
    const j = appendJournal(formatRulesEntry(changes, why));
    return j.ok
      ? { ok: true, message: `saved config/risk.json · journaled to journal/${basename(j.file)}` }
      : { ok: true, message: `saved config/risk.json — but the journal entry failed: ${j.error}` };
  };

  const detailSymbol = detailOpen && rows[sel] ? rows[sel]!.symbol : null;
  const symbolStats = useSymbolStats(detailSymbol);

  useInput(
    (input, key) => {
      if (input === "q" || (key.ctrl && input === "c")) {
        exit();
        return;
      }
      if (detailOpen) {
        if (input === "o") {
          openOrder(rows[sel]?.symbol ?? "");
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
        else if (focus === "positions") setSelected((s) => Math.min(rows.length - 1, s + 1));
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
      if (input === "l") openRules();
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
                ? rows[sel]?.symbol
                : undefined;
        openOrder(target ?? "");
      }
      if (input === "h") setHistoryOpen(true);
      if (input === "[")
        updateScanner((c) => ({ ...c, minConfidence: Math.max(1, c.minConfidence - 1) }));
      if (input === "]")
        updateScanner((c) => ({ ...c, minConfidence: Math.min(9, c.minConfidence + 1) }));
      if (key.return && focus === "positions" && rows.length > 0) {
        setDetailOpen(true);
      }
    },
    {
      isActive:
        isTTY &&
        !watchlistOpen &&
        !signalsOpen &&
        !settingsOpen &&
        !rulesOpen &&
        !orderOpen &&
        !historyOpen &&
        !themeOpen,
    },
  );

  // "This operation was aborted" is opaque; translate it.
  const friendly = error && /abort|timed out/i.test(error) ? "timed out — network down?" : error;
  const hasData = account !== null || rawPositions.length > 0;
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
      <Header book={book} buyingPower={account?.buyingPower ?? null} marketOpen={marketOpen} />
    </Box>
  );
  const statBar = <StatBar book={book} realized={realized} />;

  const statusBar = (hint: string) => (
    <StatusBar
      stream={status}
      updatedAt={updatedAt}
      count={rawPositions.length}
      hint={hint}
      note={note}
    />
  );

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

  // Shown on every screen from which `o` can reach the order ticket.
  const armedBanner = armed ? (
    <Box paddingX={1}>
      <Text bold color={t.negative}>
        ● TRADING ARMED
      </Text>
      <Text {...mutedProps(t)}> — real orders enabled · o to place · A to disarm</Text>
    </Box>
  ) : null;
  const bannerLines = (demoBanner ? 1 : 0) + (armedBanner ? 1 : 0);

  const rulesStrip = (
    <RulesStrip
      alerts={alerts}
      held={excepted}
      rules={risk}
      positionCount={rawPositions.length}
    />
  );
  const cash =
    book.known && book.equity > 0 ? { amount: book.cash, share: book.cash / book.equity } : null;
  // Banners and the rules strip span the full width above the panels, so they
  // come out of the row budget before any panel is sized.
  const extraLines =
    bannerLines + rulesStripHeight(alerts === null ? null : alerts.length + excepted.length);

  // ── Full-screen views ─────────────────────────────────────────────────────

  if (detailOpen && rows[sel]) {
    const r = rows[sel]!;
    return (
      <Box flexDirection="column">
        {headerBox}
        {statBar}
        {demoBanner}
        {armedBanner}
        <DetailPane
          row={r}
          closes={closes[r.symbol] ?? []}
          stats={symbolStats}
          stopLossPct={risk.stopLossPct}
          breach={breaches[r.symbol]}
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
          symbols={wl.symbols}
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
        {demoBanner}
        {armedBanner}
        <SignalsView
          result={scan.result}
          scanning={scan.scanning}
          error={scan.error}
          lastRun={scan.lastRun}
          minConf={scannerConfig.minConfidence}
          armed={armed}
          rows={zoomedPanelRows(termRows, bannerLines)}
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
          sectors={wl.sectors}
          update={updateScanner}
          onClose={() => setSettingsOpen(false)}
        />
        {statusBar("scanner settings · esc back")}
      </Box>
    );
  }

  if (rulesOpen) {
    return (
      <Box flexDirection="column">
        {headerBox}
        <RiskRulesEditor
          rules={risk}
          book={bookAccountState(book)}
          onSave={saveRules}
          onClose={() => setRulesOpen(false)}
        />
        {statusBar("risk rules · esc back")}
      </Box>
    );
  }

  if (orderOpen) {
    return (
      <Box flexDirection="column">
        {headerBox}
        <OrderTicket
          initialSymbol={orderSymbol || rows[sel]?.symbol || ""}
          positions={rawPositions}
          prices={prices}
          account={account ? { equity: book.equity, buyingPower: account.buyingPower } : null}
          risk={risk}
          mode={tradeMode}
          onClose={() => setOrderOpen(false)}
          onPlaced={() => {
            // Poll now, and again once a market order has had time to fill —
            // otherwise the book shows the pre-trade position for up to 20s.
            refreshAccount();
            setTimeout(refreshAccount, 3_000);
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

  // ── Zoomed section ────────────────────────────────────────────────────────
  //
  // The focused panel, given the whole terminal. Every key that works on it in
  // the grid still works here — this is the same section, bigger, not a new
  // screen. The banners and the rules strip stay: zoomed is still the live
  // dashboard, and `o` still reaches the order ticket from it.

  if (zoomed) {
    const zoomRows = zoomedPanelRows(termRows, extraLines);
    const back = "space/esc back · q quit";
    let panel: React.ReactNode;
    let hint: string;

    if (focus === "watchlist") {
      panel = (
        <Watchlist
          movers={sortedMovers}
          rows={Math.max(3, zoomRows - 7)} // border, title, header, more-lines, footnote
          cursor={wlSel}
          focused
          detail={{ sectorOf: wl.sectorOf, held }}
        />
      );
      hint = `↑↓ select${armed ? " · o order" : ""} · ${back}`;
    } else if (focus === "chart") {
      panel = (
        <EquityChart
          history={history}
          availCols={cols}
          maxWidth={cols}
          periodLabel={periodLabel}
          height={Math.max(4, zoomRows - 4)} // border, title, caveat
          focused
          caveat
        />
      );
      hint = `p period · ${back}`;
    } else {
      panel = (
        <Positions
          rows={rows}
          closes={closes}
          selected={sel}
          columns={zoomedPositionColumns(cols)}
          breaches={breaches}
          sortLabel={sortLabel}
          focused
          maxRows={fitPositions(rows.length, zoomRows)}
          cash={cash}
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
        {rulesStrip}
        {panel}
        {statusBar(hint)}
      </Box>
    );
  }

  // ── Main grid ─────────────────────────────────────────────────────────────

  const columns = positionColumns(positionsPanelWidth(cols));
  // Every panel sized to fit, positions first — see planGrid in ./layout.ts.
  const plan = planGrid({
    wide,
    nPos: rows.length,
    nMovers: sortedMovers.length,
    nSignals: scan.result ? sortedSignals.length : 0,
    contentH: contentRows(termRows, extraLines),
  });

  const positionsPanel = (
    <Positions
      rows={rows}
      closes={closes}
      selected={sel}
      columns={columns}
      breaches={breaches}
      sortLabel={sortLabel}
      focused={focus === "positions"}
      maxRows={plan.posRows}
      cash={cash}
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
      rows={plan.signalRows}
    />
  );

  // The focused panel's own keys lead the hint. They used to sit in each
  // panel's title, which wrapped in the narrow right column and shifted the
  // layout whenever focus moved; the status bar has room, and it is one line
  // whatever it says.
  const focusKeys = {
    positions: "↑↓ select · ⏎ detail · s sort",
    watchlist: "↑↓ select",
    signals: "↑↓ select · [/] line",
    chart: "p period",
  }[focus];
  const mainHint = wide
    ? `${focusKeys} · ${armed ? "o order · " : ""}space zoom · l rules · A ${armed ? "disarm" : "arm"} · h history · g signals · c settings · w watchlist · t theme · q quit`
    : "A o l h g c t · tab space q";

  return (
    <Box flexDirection="column">
      {headerBox}
      {statBar}
      {demoBanner}
      {armedBanner}
      {rulesStrip}

      {wide ? (
        <Box>
          <Box flexDirection="column" flexGrow={1} marginRight={1}>
            {positionsPanel}
            <EquityChart
              history={history}
              availCols={chartCols}
              periodLabel={periodLabel}
              height={plan.chartRows}
              focused={focus === "chart"}
            />
          </Box>
          <Box flexDirection="column" width={34}>
            <Watchlist
              movers={sortedMovers}
              rows={plan.watchRows || WIDE_FALLBACK_WATCH}
              cursor={wlSel}
              focused={focus === "watchlist"}
            />
            {signalsPanel}
          </Box>
        </Box>
      ) : (
        <Box flexDirection="column">
          {positionsPanel}
          <EquityChart
            history={history}
            availCols={chartCols}
            periodLabel={periodLabel}
            height={plan.chartRows}
            focused={focus === "chart"}
          />
          <Watchlist
            movers={sortedMovers}
            rows={plan.watchRows || NARROW_WATCH_ROWS}
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

/** Watchlist rows before any movers have loaded (the panel shows "loading…"). */
const WIDE_FALLBACK_WATCH = 12;
