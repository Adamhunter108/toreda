# Data sources

What toreda reads today, and what you could upgrade to.

---

## What it uses now

Zero cost, and only one of them needs a key.

| Capability | Source | Needs |
|---|---|---|
| Prices, bars, snapshots | Alpaca Market Data | your Alpaca key |
| News headlines | Alpaca Market Data | your Alpaca key |
| Movers, most-actives | Alpaca screeners | your Alpaca key |
| Account, positions, assets | Alpaca Trading | your Alpaca key |
| Social sentiment, trending | StockTwits | nothing — free, public |
| Briefing delivery *(optional)* | Telegram | a bot token |

The dashboard shows this live under **Scanner settings** (`c`), including which
sources are currently active.

### About the free Alpaca feed

The free plan serves **IEX** — one exchange, a partial slice of consolidated
volume. Fine for liquid names; sparse on thin ones, where the last price can
differ noticeably from the consolidated last.

It also permits **one concurrent websocket connection**. Open a second dashboard
and the first reports `stream limited`. That is the plan, not a bug.

### About StockTwits

An **unofficial, undocumented public API** with no stability guarantee and no
agreement with us. It can change or rate-limit without notice.

toreda treats it accordingly: every failure degrades the scan rather than
killing it, and the scan says which source it lost. Turn it off entirely with
`useStockTwits: false` in `config/scanner.json`, or the toggle in the dashboard's
settings view.

---

## Paid upgrades

None of this is required, and nothing below is currently integrated — this is a
field guide for deciding what would be worth adding. **Prices are ballpark and
change.** Free tiers are flagged heavily, since they let you try an adapter
without a credit card.

### Prices, bars, real-time quotes

| Provider | Best for | Free tier | Rough cost |
|---|---|---|---|
| **Alpaca (paid data)** | Full-market **SIP** real-time | — | ~$99/mo |
| **Polygon.io** | The popular all-rounder; deep history, websockets | ✅ delayed | ~$29–199/mo |
| **Finnhub** | Best free tier for prices; also news + fundamentals | ✅ good | ~$0–50+/mo |
| **Tiingo** | Cheap, clean end-of-day + intraday | ✅ limited | ~$10–50/mo |
| **Twelve Data** | Easy start, websockets | ✅ | ~$0–29+/mo |

Upgrading Alpaca is the least work — same keys, and it removes the one-connection
limit as well as the IEX/SIP gap.

### News and catalysts

*The highest-value upgrade for this scanner specifically.* News is the channel
with the crudest implementation — keyword tone counting — so better data helps
most here.

| Provider | Best for | Free tier | Rough cost |
|---|---|---|---|
| **Benzinga** | Trader-grade real-time catalysts | — | $$$ (sales) |
| **Marketaux** | Financial news **+ sentiment**, per-ticker | ✅ | ~$0–30+/mo |
| **Alpha Vantage** | News + sentiment endpoint | ✅ | free / paid |
| **Finnhub** | Company news, bundled with prices | ✅ | ~$0–50/mo |

### Social and alternative data

| Provider | Best for | Free tier |
|---|---|---|
| **StockTwits** | What's used now | ✅ |
| **Quiver Quantitative** | Congressional trades, insider, lobbying | ✅ limited |
| **ApeWisdom** | Reddit mention counts | ✅ |
| **LunarCrush** | Broad social scoring | ✅ limited |

### Fundamentals

Would unlock a **new signal type** rather than improving an existing one —
valuation-based screening pairs naturally with the existing `value_play`.

| Provider | Best for | Free tier |
|---|---|---|
| **Financial Modeling Prep** | Fundamentals + screener, cheap | ✅ |
| **Finnhub** | One key, many capabilities | ✅ |
| **SEC EDGAR** | Raw filings, official, no key | ✅ 100% free |

---

## A free stack worth trying

Costs nothing and beats the current baseline:

- **Finnhub** — prices, news and fundamentals under one key
- **Marketaux** or **Alpha Vantage** — news with real sentiment scoring
- **FMP** — fundamentals

---

## If you want to add one

Not yet built, but the shape it should take:

1. **Curated adapters, not arbitrary endpoints.** Each provider gets a small
   adapter mapping its response onto the scanner's internal shape. Auto-adapting
   arbitrary APIs is a trap — every provider disagrees about field names,
   timestamps and pagination.
2. **A `sources` block in `config/scanner.json`** mapping each capability
   (prices / news / social / fundamentals) to a chosen provider.
3. **Keys live in `.env`, never in `scanner.json`.** The config names a provider;
   the secret stays in the gitignored file.
4. **Graceful fallback.** If a premium source errors or rate-limits, fall back to
   the Alpaca/StockTwits default. A configured premium key must never make a scan
   *worse* than no key at all.

The existing source layer already models this: see `src/scanner/sources/` and
the `SourceHealth` type, which is how a degraded source reports itself instead of
failing the run.

Best first step: grab a free Finnhub or Marketaux key and design the adapter
against a real response rather than a documented one.
