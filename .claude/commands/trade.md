---
description: Guided order — preview, bear case, my confirmation, then journal
argument-hint: SYMBOL [buy|sell] [QTY]
---

I want to trade **$ARGUMENTS**. Walk me through it properly.

This command does **not** authorise you to place an order. It sets up the
decision; I make it. Follow these steps in order and stop where told.

### 1. Context

```bash
npm run toreda -- portfolio --json
npm run toreda -- quote <SYMBOL> --json
```

Do I hold it? At what weight, against what ceiling? How much cash is there
(`funds.cash` in `account --json`; buying power includes margin)? For a
sell, how many shares do I actually have?

### 2. Preview — sends nothing

```bash
npm run toreda -- order <SYMBOL> <side> <qty>
```

Without `--confirm` this transmits nothing; it prints the cost, the buying-power
check, and any risk warnings. Show me that output.

If it reports a **block**, stop here and tell me what needs to change. Blocks are
things that cannot work — no price, not enough buying power, selling more than I
hold. Don't work around one.

### 3. The bear case

Before I confirm, argue against this trade. Not a disclaimer — an actual case:

- Which entry criteria does it satisfy, and which is it missing? Two of three is
  the bar; one is not enough.
- What does the position look like if it goes wrong? Where is the stop, in
  dollars, and am I willing to lose that?
- Does this worsen concentration — in the symbol, or in its sector?
- Is there a version of this trade that is better? Smaller, later, limit instead
  of market, a different name with the same thesis?

If the trade looks unwise, say so plainly. I asked for a guided trade, not
agreement.

### 4. Stop and wait

Ask whether I want to proceed. **Then stop.** Do not run anything with
`--confirm` until I answer, in this session, with a clear yes.

If I say yes, run exactly the order that was previewed — same symbol, same side,
same quantity, same type. If any of it needs to change, go back to step 2.

### 5. Journal it

After a fill, append to `journal/YYYY-MM.md`:

```
## YYYY-MM-DD
- **BUY 5 NVDA @ $196.82** (~$984) — the reason, in my words not the scanner's.
  Against: the strongest point from the bear case.
  Wrong if: the concrete condition that would prove this a mistake.
```

Write the reasoning **now**, while the outcome is unknown. A journal written
after the fact records what happened, not what was believed, and teaches
nothing. The "wrong if" line is what lets a future review tell a good decision
from a lucky one.
