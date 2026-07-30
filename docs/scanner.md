# How the scanner works

`toreda scan` produces three separate things, in this order:

1. **Rule breaches** — your own risk rules, checked against every position
2. **Signals** — ranked, scored, position-aware, drawn from your watchlist
3. **Discovery** — liquid names moving but untracked, unvetted

The order is deliberate and not cosmetic: managing what you already own outranks
adding to it. The three blocks never mix.

Everything below is plain arithmetic — **no model produces a signal.** That's why
each score prints its own breakdown, and why you can argue with one.

---

## What confidence means

A signal's confidence is a sum of named components, clamped to 1–9:

```
score: +5 momentum base, +2 move size, +1 volume confirms, +1 news corroboration
```

**It is not a probability.** `8/10` means "look at this first", not "80% likely
to work". There is no backtest behind it and no calibration. It is a ranking aid
that sorts a list, and its only real virtue is that it shows its work — if you
disagree with a component, you can see which one and why.

Signals below `minConfidence` (default 7) are hidden from the report. The
dashboard dims them rather than hiding them, since a hidden signal and no signal
look identical.

---

## The four signal types

### Momentum

Price rose at least `momentumPct` (5%) across the lookback window.

```
+5  momentum base
+2  move size          (+1 per 5%, capped at 2)
+1  volume confirms    (or −1 when it doesn't)
+1  news corroboration (the symbol appears in recent headlines)
```

Volume is compared against the window average **excluding the final bar**, which
is partial while the market is open, then scaled by how much of the session has
elapsed. Without that scaling a 10am scan compares two hours of volume against
full prior days and concludes nothing is confirmed.

Action: `buy`.

### Value play

Price fell at least `valuePullbackPct` (−8%) across the window.

```
+6  pullback base
+2  depth of pullback  (+2 past −20%, else +1)
+1  news corroboration
```

Action: **`watch`, never `buy`.** A falling knife and a bargain are
indistinguishable until afterwards, so this type never directs an entry.

### News catalyst

Headlines are pulled from Alpaca's news API. Symbols come from the API's own
tagging, never from matching text against tickers.

```
+5  news base
+1  tone in N/M headlines
+1  sustained coverage   (3+ scored headlines)
+2  price action agrees
```

Tone is counted **one headline at a time**, and needs at least two headlines on
the winning side. Keywords match as whole words: `miss` does not match "Missing",
`fall` does not match "shortfall", `cut` does not match "executing".

**Headlines that merely report the price move are excluded from tone entirely.**
"Nvidia Stock Falls 5%" scored as bearish tone *and* confirmed by a −5% move is
one fact counted twice — which is how a signal comes to corroborate itself.

Action: `watch` unless price confirms, then `buy`/`sell`.

### Social buzz

StockTwits posts carrying the author's own Bullish/Bearish tag. Untagged posts
are skipped rather than guessed at.

```
+5  social base
+2  sample size     (20+ tagged posts, else +1)
+1  one-sided lean  (80/20 or stronger)
```

Needs at least 8 tagged posts, and `socialBullShare` (70%) on one side.

Action: `buy` when bullish, **`watch` when bearish — never `sell`.** Crowd tags
are a crowding indicator, not an edge, and a bearish crowd is at least as often
a bottom as a top.

---

## Price confirmation, scaled to the symbol

The most important threshold in the scanner, and the least obvious.

When news tone points one way, price over the same window has to agree before
the signal directs a trade. The question is: how far is far enough?

A flat percentage cannot answer that. `pctChange` measures the **whole window**
(~11 trading days), so a flat 2% floor asks NVDA — which moves ~3% on a quiet
day — to drift 2% over eleven sessions before its news "confirms". That is far
inside noise. It is what once let a nothing-happened fortnight ratify a bearish
headline into a SELL at confidence 9.

So the threshold scales by the symbol's own realized volatility:

```
needed = max(newsPriceAgreePct, newsPriceAgreeSigma × dailyVol × √days)
```

`√days` is the standard random-walk scaling of daily volatility to a multi-day
window. The configured floor stays on so a very quiet name still has to do
something. In practice a volatile semiconductor needs a ~7% move to confirm
where a utility needs 2%.

Raising `newsPriceAgreeSigma` makes news direct trades less often. Lowering it
does the opposite — and is the single fastest way to make this scanner worse.

---

## Position awareness

Every signal is reconciled against what you actually hold. Without this, a
scanner recommends buying something you already hold at +100% with no buying
power left.

- **Held positions are always scanned**, watchlist or not
- A `buy` on a position that is both **past its ceiling and deeply profitable**
  (`trimProfitPct`, default +25%) becomes a **`trim`** — the situation where a
  momentum signal is most tempting and most dangerous
- Approaching the ceiling adds a note without changing the action
- A position **at or past the stop** turns any signal into `sell`
- Buys are flagged as unactionable when buying power is under $25

---

## Rule breaches

Checked against **every** position on **every** scan, independently of whether
the market said anything about that symbol.

This exists because the rules were once applied only as a modifier on market
signals — so a position breaching its concentration cap while trading quietly
produced no signal and was never mentioned. The largest risk in a portfolio is
rarely the noisiest name.

Two rules, from `config/risk.json`:

- **STOP LOSS** — at or past `stopLossPct` (default −7%) from entry. Boundary
  inclusive: exactly −7% trips it.
- **CONCENTRATION** — above its ceiling, either `defaultMaxWeight` (25%) or a
  per-symbol override.

Stop-loss breaches sort above concentration ones. An override raises the *size*
ceiling only — the stop applies to every position without exception.

---

## Discovery

Liquid names moving but not on your watchlist, pulled from StockTwits trending
plus Alpaca's movers and most-actives screens.

Raw screener output is roughly 90% unusable for a personal account, so
everything passes gates: minimum $10 price, minimum $25M previous-session dollar
volume, nothing stale, no warrants/units/rights, no leveraged or inverse
products, tradable on Alpaca.

**The rejection counts are printed** — `filtered out: 41 under $10, 19
warrant/unit/right, 15 illiquid` — so an over-aggressive filter is visible rather
than silently producing a confident-looking empty list. Names passing the gates
but exceeding the display cap are counted too, never dropped silently.

Discovery output is **unvetted by construction**: surfaced by a screen, not
analysed. See [building-a-watchlist.md](building-a-watchlist.md) for how to
promote one properly.

Skip the pass with `--no-discovery`.

---

## When a source fails

Scans degrade rather than dying. If a source is unreachable the scan completes
without it and says so:

```
⚠ Partial scan — some sources were unavailable:
    • StockTwits unreachable (ENOTFOUND api.stocktwits.com)
```

This matters because **a scan missing its news source looks exactly like a quiet
news day.** "No social signals" and "we could not ask" are different claims, and
only one of them is information.

`degraded` appears in `--json` output too.

---

## Every setting

`config/scanner.json`, editable by hand or in the dashboard (`c`).

| Setting | Default | What it does |
|---|---|---|
| `minConfidence` | 7 | Signals below this aren't reported |
| `maxSignals` | 12 | Cap on reported signals |
| `lookbackDays` | 14 | Calendar days of price history (~10 trading days) |
| `signalTypes.*` | all on | Turn individual signal types off |
| `thresholds.momentumPct` | 5 | Window move that counts as momentum |
| `thresholds.momentumVolumeMult` | 1.2 | Volume multiple that confirms a move |
| `thresholds.valuePullbackPct` | −8 | Drawdown that marks a possible entry |
| `thresholds.newsPriceAgreePct` | 2 | Absolute floor for price confirming tone |
| `thresholds.newsPriceAgreeSigma` | 1 | Multiples of the symbol's own volatility |
| `thresholds.socialBullShare` | 0.7 | Share of tagged posts needed for a lean |
| `discovery.enabled` | true | Run the untracked-movers pass |
| `discovery.minPrice` | 10 | Price floor for candidates |
| `discovery.minDollarVolume` | 25000000 | Liquidity floor |
| `sectorFocus` | `[]` | Empty means all sectors |
| `useStockTwits` | true | Turn off if the unofficial API is flaky |

---

## Machine-readable output

```bash
npm run toreda -- scan --json
```

Returns `opportunities`, `positionAlerts`, `discovery`, `minConfidence`, `mode`,
`degraded`, and `scannedAt`. Progress messages go to stderr, so stdout stays
parseable.
