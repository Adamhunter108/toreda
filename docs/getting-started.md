# Getting started

This assumes you have never used Alpaca and have never written a line of
TypeScript. Every step says what to do and what you should see.

Total time: about fifteen minutes, most of it waiting for an Alpaca account.

> **You will not risk any money following this guide.** Setup defaults to paper
> trading — a simulated account with fake money that behaves like the real one.

---

## 0. Want to look first?

If you'd rather see what this is before signing up for a brokerage account, you
only need step 1 below. Then:

```bash
npm run demo
```

That opens the dashboard filled with a fake portfolio — five positions, live
prices, a working scan. Nothing connects to a real account and no order can be
placed. Every command takes `--demo` too:

```bash
npm run toreda -- portfolio --demo
npm run toreda -- scan --demo
```

---

## 1. Install Node

toreda needs **Node 22 or newer**. Check what you have:

```bash
node --version
```

If that prints `v22.x` or higher, skip ahead. If it errors or prints something
lower, install Node from [nodejs.org](https://nodejs.org) — take the LTS
version — and run the check again in a **new** terminal window.

<details>
<summary>Why 22?</summary>

toreda uses Node's built-in WebSocket client for live prices, which arrived in
Node 22. Using it means one less dependency in a program that holds your
brokerage keys.
</details>

---

## 2. Create an Alpaca account

[Alpaca](https://alpaca.markets) is the broker toreda trades through. Signing up
is free, and **paper trading requires no deposit and no funding**.

1. Sign up at [alpaca.markets](https://alpaca.markets)
2. Once you're in, find the **Paper Trading** toggle — Alpaca gives every account
   a simulated one alongside the real one. Make sure you are on **paper**.
3. Look for **API Keys** and generate a key pair.
4. You'll see a **Key ID** and a **Secret Key**. The secret is shown **once**.
   Copy both somewhere before leaving the page.

> **Paper and live have completely separate keys.** Getting these mixed up is the
> most common setup problem. If a key was generated while the dashboard said
> "Paper Trading", it is a paper key and will not work for live — and vice versa.
> toreda checks this for you and says which one it thinks you pasted.

---

## 3. Install toreda

```bash
git clone <repository-url> toreda
cd toreda
npm install
```

`npm install` takes a few seconds and prints a summary. A note about funding or
audit is normal.

---

## 4. Run setup

```bash
npm run setup
```

Six questions:

1. **Paper or live** — press Enter for paper. (Choosing live requires typing the
   word `LIVE` in full; anything else falls back to paper.)
2. **Key ID** — paste it.
3. **Secret** — paste it. It shows as `••••` rather than plain text.
   toreda then checks the pair against Alpaca and prints your account number.
   **If it says the keys were rejected, you almost certainly copied live keys
   while asking for paper, or the reverse.**
4. **Watchlist** — press Enter for a broad 25-symbol starter across eight
   sectors. You can also import whatever you already hold, or start empty.
5. **Risk rules** — press Enter three times to accept the defaults (sell at −7%
   from entry, no single position above 25% of the portfolio, consider trimming
   an oversized winner above +25%). You can change these later.
6. **Theme** — pick one. `Default` inherits your terminal's own colours.

It finishes by checking the trading API, the market data API, and your mode.

---

## 5. Confirm it works

```bash
npm run doctor
```

You want green ticks under Environment, Configuration, Files and Connectivity.

**Circles (`○`) are not errors.** They mark optional features you haven't set
up — Telegram delivery, Claude commentary, live keys. A fresh install shows
several, and that's correct.

---

## 6. Look around

```bash
npm run toreda -- portfolio     # your positions (empty at first)
npm run toreda -- account       # buying power and equity
npm run toreda -- quote NVDA    # a live quote
npm run toreda -- watchlist     # everything you're tracking, biggest movers first
```

Then the two interesting ones:

```bash
npm run toreda -- scan          # ranked signals, rule breaches, untracked movers
npm run dash                    # the live dashboard
```

In the dashboard: `tab` cycles panels, `↑↓` moves, `enter` opens a position,
`r` runs a scan, `t` changes theme, `q` quits. A wide terminal (100+ columns)
gets a richer two-column layout.

Prefer a bare `toreda` command to `npm run toreda --`? Run `npm link` once.

---

## 7. Your first paper trade

Orders are two steps by design. The first sends nothing:

```bash
npm run toreda -- order NVDA buy 1
```

You'll see the estimated cost, your buying power, and any risk warnings, ending
with **"Preview only — nothing sent."**

To actually place it:

```bash
npm run toreda -- order NVDA buy 1 --confirm
```

That's the whole safety model: the dangerous thing needs an extra deliberate
step, and the safe thing is what happens if you're unsure. It works identically
on live money.

Check what happened:

```bash
npm run toreda -- portfolio
npm run toreda -- history
```

---

## 8. Write down why

```bash
echo "## $(date +%F)
- **BUY 1 NVDA** — reason. What would make this wrong." >> journal/$(date +%Y-%m).md
```

This feels like overhead and is the highest-value habit in the whole toolkit.
**Write the reasoning before you know the outcome.** A journal written afterwards
records what happened, not what you believed — which means it can't tell you the
difference between a good decision and a lucky one.

---

## Where next

- **[Building a watchlist](building-a-watchlist.md)** — choosing what to track,
  and how to avoid a list that's one bet wearing twenty tickers
- **[How the scanner works](scanner.md)** — what each signal means and what
  every threshold does
- **[Briefings](briefings.md)** — optional scheduled market summaries
- **[Data sources](data-sources.md)** — what toreda reads, and paid upgrades
- **[`templates/trading-plan.md`](../templates/trading-plan.md)** — a starting
  point for writing down your own rules

Using [Claude Code](https://claude.com/claude-code)? Open it in this directory
and try `/morning`. It reads `CLAUDE.md` automatically, including the rule that
nothing trades without your explicit say-so.

---

## When something breaks

**`No .env found`** — setup hasn't run, or you're in the wrong directory.
Run `npm run setup` from inside the toreda folder.

**`Alpaca rejected those keys`** — paper/live mismatch nine times in ten.
Regenerate keys with the Alpaca dashboard on the mode you actually want.

**`Missing ALPACA_PAPER_KEY_ID / ALPACA_PAPER_SECRET`** — `.env` exists but the
keys for your current mode are blank. Re-run setup, or edit `.env` by hand.

**`timed out — network down?`** — toreda couldn't reach Alpaca. Check your
connection; if you're on a VPN, that's the first thing to test.

**`stream limited — free tier allows 1`** — Alpaca's free plan permits one live
price connection. Close the other dashboard or script holding it.

**`⚠ Partial scan — some sources were unavailable`** — a data source failed and
the scan continued without it. Usually StockTwits, which is a free unofficial
API. Turn it off in the dashboard's settings (`c`) if it's flaky for you.

**The dashboard looks like garbage characters** — on Windows, use Windows
Terminal rather than the legacy console. `doctor` warns about this.

**Prices look wrong or stale** — the free plan uses the IEX feed, a partial
slice of total volume. Fine for liquid names, sparse on thin ones. See
[data-sources.md](data-sources.md).

Still stuck? `npm run doctor` prints what it can see, and its output is the most
useful thing to share when asking for help. It never prints your keys.
