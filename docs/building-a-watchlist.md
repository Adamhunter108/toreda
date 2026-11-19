# Building a watchlist

The watchlist is the universe toreda pays attention to. It lives in
`config/watchlist.json`, and it is the single thing most worth getting right —
the scanner can only find what you point it at.

---

## The one rule

**A watchlist of thirty names from one industry is one bet wearing thirty
tickers.**

This is the mistake worth avoiding above all others, and it is easy to make
because it doesn't look like a mistake. You pick companies you understand.
People who understand semiconductors pick semiconductors. The list grows to
twenty names, all of which fall together on the same bad Tuesday, and the
portfolio built from it has the *appearance* of diversification without any of
the substance.

You can hold a concentrated book deliberately. Plenty of people do, and it can
be the right call. But it should be a decision you made, not one your watchlist
made for you while you were looking at something else.

The shipped default spans eight sectors for this reason, and there is a test
asserting it stays that way.

---

## What belongs on it

**Liquid names.** Dollar volume matters more than price. A thinly traded stock
can be entered easily and exited only at a discount, and the discount arrives
exactly when you most want out. The discovery pass enforces a $25M
previous-session dollar-volume floor for this reason; apply the same instinct to
names you add by hand.

**Businesses you can form a view about.** The scanner tells you something moved
and roughly why. It cannot tell you whether that matters. If you have no way to
judge whether a 6% move in a company is a buying opportunity or the beginning of
something bad, that symbol will generate signals you can't act on.

**Things you would actually buy.** A watchlist is not a wishlist of interesting
companies. Every symbol on it is a claim that you'd put money into it under the
right conditions. Names that fail that test add noise to every scan.

**Enough to be interesting, few enough to know.** Twenty to forty is a
reasonable range. Below fifteen, most scans return nothing and you stop running
them. Above sixty, you can't hold the names in your head and the scanner becomes
a slot machine you pull for suggestions.

---

## What does not belong

**Leveraged and inverse ETFs.** `TQQQ`, `SQQQ`, `SOXL` and their relatives decay
against their own index over time because of how daily rebalancing compounds.
They are instruments for expressing a view over days, not names to hold. The
discovery pass filters them out; don't add them back by hand.

**Warrants, units, and rights.** Five-letter tickers ending in W, U or R are
usually derivatives of a listing rather than a business.

**Anything under about $10.** Not snobbery — a floor filters out most of what
makes screener output unusable, and toreda's discovery gates on it.

**Names you added because they moved once.** The discovery block exists to
surface those. Promoting one to the watchlist should be a decision made a few
days later, calmly.

---

## Sectors

Sector names are yours to invent. They are labels for grouping and for the
scanner's `sectorFocus` setting, not a fixed taxonomy:

```json
{
  "sectors": {
    "Semiconductors": ["NVDA", "AMD", "AVGO", "TSM"],
    "Healthcare": ["UNH", "JNJ", "LLY"],
    "Boring things that pay dividends": ["KO", "PG"]
  }
}
```

Two reasons to keep them honest. Signals are labelled with their sector, so a
run where every signal shares one is a visible warning. And `sectorFocus` in
`config/scanner.json` narrows scans to chosen sectors, which only works if the
grouping means something.

The useful test: **if two sectors always move together, they are one sector.**
Splitting "Semiconductors" from "AI Hardware" produces two labels and one bet.

---

## Editing it

From the command line:

```bash
npm run toreda -- watchlist add NVDA
npm run toreda -- watchlist remove TSLA
npm run toreda -- watchlist              # everything, biggest movers first
```

`add` validates the ticker against Alpaca before writing. This matters more than
it sounds: **a typo'd symbol in a watchlist is silent.** It never produces a
signal, and you quietly conclude the market was uneventful.

From the dashboard, press `w`. From a text editor, open
`config/watchlist.json` — every route writes the same file.

### Keeping specific names in view

The dashboard's watchlist panel is short, so with a long list most names sit
below the fold. Two keys decide which ones you see:

- **`s`, with the watchlist focused** (`tab` to it), cycles the panel's order:
  *by move* (the biggest move today, up or down), *your order*, and *A–Z*. The
  choice is saved in `config/ui.json`, so it survives a restart.
- **`w`, then `enter`** picks up the highlighted symbol. `↑`/`↓` carry it,
  `enter` puts it down, and `esc` puts it back where it was. (`K`/`J` move it
  one place without picking it up.) That is *your order*: put the names you
  watch most at the top.

Your order is stored as an `order` list in `config/watchlist.json`. It only
affects display. Sectors stay as they are, and a symbol added without a place
in the order goes to the end.

**Positions you hold are always scanned**, listed or not. You cannot stop
watching something you own by deleting a line.

---

## Starting from a preset

`npm run setup` offers three, and you can copy one over later from
`config/presets/`:

**`broad-market`** — 25 names across eight sectors. The default, and the right
choice if you're unsure. Deliberately unexciting.

**`technology`** — 21 names, concentrated by design. Read its own comment before
choosing it: these move together, and a portfolio built from it is closer to one
position than to twenty.

**`dividend-value`** — 25 slower-moving established businesses. Worth knowing
that the scanner's momentum thresholds are tuned for names that move, so this
universe produces fewer signals. That's a property of the names, not a fault —
lower `momentumPct` in `config/scanner.json` if you want more.

Or **import your current positions**, which is the honest starting point if you
already hold things: it makes the watchlist reflect the book you actually have
rather than the one you're imagining.

---

## Growing it over time

The discovery pass surfaces liquid names that are moving but untracked. That is
the intended pipeline for finding new symbols — but the pipeline has a middle
step people skip:

1. Discovery surfaces a name that's moving
2. **Add it to the watchlist and let it accumulate history**
3. *Then* decide

Buying straight off the discovery block skips the part where the scanner builds
price and news context for the symbol, which is the whole reason to track it
first. Discovery output is unvetted by construction — surfaced by a screen, not
analysed.

Prune too. A symbol you've ignored for three months is noise in every scan
between now and when you remove it.

---

## A worked example

Someone whose book is entirely semiconductors and wants to fix it:

**Before** — six names, one sector:

```json
{ "sectors": { "Semis": ["NVDA","AMD","TSM","AVGO","ARM","MU"] } }
```

**After** — the same conviction, plus somewhere else to go:

```json
{
  "sectors": {
    "Semiconductors": ["NVDA", "AMD", "TSM", "AVGO"],
    "Healthcare":     ["UNH", "LLY", "JNJ"],
    "Consumer":       ["COST", "PG", "KO"],
    "Financials":     ["JPM", "V"],
    "Energy":         ["XOM", "NEE"],
    "Broad Market":   ["SPY"]
  }
}
```

Note what did *not* happen: the semiconductor conviction wasn't abandoned. Four
names survived — the two weakest were cut, not the thesis. What changed is that
when semis have a bad month, the scanner now has somewhere else to look, and the
`sectorFocus` setting becomes usable.

Adding `SPY` is a small, underrated move: it gives every scan a baseline. A
signal on a name that moved 4% while the whole market moved 3.5% is a different
signal than one that moved 4% on a flat day.
