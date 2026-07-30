---
description: Where do I stand — positions, rule breaches, and what's moving
---

Give me a read on the day. Run these and synthesise; don't just paste output.

```bash
npm run toreda -- portfolio --json
npm run toreda -- scan --json
```

Structure the answer in this order, because it is the order that matters:

**1. Rule breaches first.** Anything in `positionAlerts` — a stop hit, a
position past its ceiling. These outrank every opportunity below them. If there
are none, say so in one line and move on.

**2. Where the book stands.** Total equity, today's move, buying power. Then any
position worth a mention — an unusual move, something approaching its ceiling.
Use `changeToday` for today and `unrealizedPlPct` for lifetime, and never
confuse the two.

**3. The top one or two signals.** Not all of them. For each: what it is, why
the scanner scored it that way (quote the breakdown), and **what would make it
wrong**. A signal you can't argue against is one you haven't examined.

**4. Anything I can't act on.** If buying power is low, say which signals are
unactionable rather than pitching trades I can't take.

Then stop. Do not place orders, and do not suggest I should.

Notes:
- If `degraded` is non-empty, say so up front — a scan missing its news source
  looks exactly like a quiet news day.
- Discovery names are unvetted screen output. Mention them only as "worth a
  look", never as recommendations.
- Check the mode. If it says LIVE, this is real money.
