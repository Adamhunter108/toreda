# Trading plan — template

Copy this to `docs/trading-plan.md` (gitignored) and make it yours.

```bash
cp templates/trading-plan.md docs/trading-plan.md
```

The point of writing this down is not the document. It is that **a rule decided
in advance is a different thing from a decision made while looking at a losing
position.** Everything below is a prompt to make those decisions now, calmly,
once.

> **Keep prices out of it.** A plan that hardcodes "NVDA is expensive at $875"
> is wrong within months and quietly keeps being cited. Prices belong in the
> tools — `toreda quote`, `toreda portfolio`, `toreda scan`. What lives here are
> rules and process, which age far more slowly.

---

## The account

**What this money is:** *(Money you can afford to lose entirely? Long-term
savings? Be honest — this determines everything below.)*

**Risk tolerance:**

**What you're actually here for:** *(Learning? Income? Growth? "Returns" is not
an answer — most people trading a small account are paying tuition, and it helps
to say so.)*

---

## How this system works

There is no autopilot. The scanner filters and ranks; you decide. `toreda order`
previews by default and transmits only with `--confirm`. Nothing else in the
toolkit can place a trade.

A session looks like:

```bash
npm run toreda -- portfolio     # where do I stand
npm run toreda -- scan          # what's moving, and what does it mean for MY book
npm run toreda -- order SYM buy N            # preview
npm run toreda -- order SYM buy N --confirm  # send
```

Then write the trade into `journal/YYYY-MM.md`, reasoning included — especially
when it goes wrong.

---

## Position sizing

These live in `config/risk.json` and are checked on every scan. **They don't
block anything** — orders place whatever you confirm. They decide when the
scanner taps you on the shoulder.

| Rule | Your limit | Default |
|---|---|---|
| Single position, maximum | | 25% of portfolio |
| New position, starting size | | ~5%, scale up only if the thesis works |
| Cash floor | | — |
| Stop loss | | −7% from entry, no exceptions |

**Set these where you would ACTUALLY want warning.** A threshold you intend to
ignore is worse than none, because it trains you to skim the block where genuine
stop-loss breaches appear.

### Documented exceptions

If you deliberately want a larger position in something, change the rule rather
than ignoring the alert. Record it in `config/risk.json` with a date and a
reason:

```json
"overrides": {
  "GOOGL": {
    "maxWeight": 0.40,
    "decided": "2026-01-15",
    "reason": "Long-term holding. Accepting the single-name concentration."
  }
}
```

The date and reason are the entire point. Without them, an override is
indistinguishable from drift when you review it in six months.

**An override raises the size ceiling only.** The stop applies to every position
without exception. Conviction about a company is not a reason to tolerate an
open loss.

---

## Entry criteria

A trade needs **at least two** of these, never one alone:

- **Price** — momentum with volume confirmation, or a pullback into support
- **Catalyst** — earnings, product, guidance, an actual event
- **Thesis** — a reason this business is worth more later

Explicitly **not** an entry reason on its own:

- **Social sentiment.** Crowd tags are a crowding indicator, not an edge.
- **News tone with no price confirmation.** The scanner downgrades these to
  `watch` for exactly this reason.

The scanner is a *filter*, not a signal. Its confidence score is a heuristic
ranking aid built from named components — **not a probability**. An 8/10 means
"look at this first", not "80% likely to work".

---

## Exit criteria

```
Losses:  -X% from entry → sell. Not "reassess". Sell.
         The scanner flags any position at or past this automatically.

Profits: Take some off at the first target.
         Let the rest run; don't round-trip a winner.

Size:    If a position exceeds ITS ceiling through appreciation, trim back
         to that ceiling. A win that becomes a concentration risk is no
         longer a win.
```

*(Fill in your own numbers. The defaults are −7% and 25%.)*

---

## What you're deliberately accepting

*(This section is the one people skip and the one that pays off. Write down the
risks you are choosing, so a future you can tell a considered bet from an
accident.)*

Prompts:

- Is your book concentrated in one sector? Is that deliberate?
- Do your positions correlate? Four names that fall together is one position.
- What would a 30% drawdown in your largest holding do — to the account, and to
  your willingness to follow this plan?
- What's the worst realistic outcome, and are you genuinely fine with it?

---

## Learning objectives

*(If the account is small, returns are not the point — the process is. What are
you actually trying to get better at?)*

- **Position discipline:** does an oversized winner get trimmed to the cap, or
  rationalised? Track which one happens.
- **Journalling:** every trade gets reasoning written *before* the outcome is
  known. A journal written after the fact teaches nothing.
- **Rule adherence:** when a stop triggers, do you sell?

**Review cadence:** *(weekly position check? monthly journal read? Write it down
and it might happen.)*

---

## Watchlist

`config/watchlist.json` is the single source of truth, shared by the CLI, the
scanner and the dashboard. Open positions are always scanned whether or not they
appear there.

See [docs/building-a-watchlist.md](../docs/building-a-watchlist.md).

**Two different things come out of a scan:**

1. **Signals** — ranked, scored, position-aware, from your curated universe.
   This is the part to act on.
2. **Discovery** — liquid names moving but untracked. **Unvetted**: surfaced by
   a screen, not analysed. A prompt to go and look, never a reason to buy.

Promoting a discovered name: add it to the watchlist, let it accumulate price
and news history, *then* decide.
