---
description: Every position against my own risk rules
---

Check the whole book against my rules. This is a deliberate review, not a
market read — I want to know whether I'm following the discipline I set.

```bash
npm run toreda -- portfolio --json
npm run toreda -- scan --json
```

`portfolio --json` gives each position's `weight` and its `maxWeight` ceiling
alongside `risk`, so concentration is a direct comparison rather than something
to recompute. It also gives each position's `stop`: the `price` where the rule
is reached, its `pct`, and whether it is measured `from` entry or the high since
I bought. Use it rather than recomputing from `stopLossPct`, which with sized
stops is only the fallback. `stop` is null for a core fund, which has none.

For every position, state:

- **Stop** — is it at or past its `stop.price`? The rule says sell, not
  reassess. If one is breached, that is the headline of this review. If
  `stopProblem` is set, say the stops fell back to the default from entry.
- **Size** — its weight against its own ceiling. Note anything above 80% of its
  allowance, not only what has breached.
- **Overrides** — if a symbol has a raised ceiling in `risk.json`, quote the
  recorded date and reason, and ask whether that reasoning still holds. An
  override with a stale rationale is drift wearing a decision's clothes.
- **Stop exceptions** — if a symbol is held past the default stop under a
  `stopOverrides` entry (`stopExceptions` in `scan --json`), quote its reason
  and end date, say how many days remain, and ask whether the event it was
  waiting for has happened. Once it has, the exception has done its job.

Then, across the book:

- **Concentration by sector.** Four positions in one sector is one bet with four
  tickers. Say so plainly if that's what you see.
- **Cash.** How much dry powder, and whether that's consistent with what I said
  I wanted.
- **Rules I'm not following.** If a threshold has been breached for a while and
  nothing happened, that is the finding. A threshold nobody acts on is worse
  than no threshold — it trains me to skim the block where the real breaches
  appear. Say it directly.

End with the single most important thing to address, and what changing it would
mean concretely — including which config value to edit if the right answer is
that the rule itself is wrong.

No orders.
