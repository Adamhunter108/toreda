---
description: Dig into one symbol — the case for it, and the case against
argument-hint: SYMBOL
---

Analyse **$ARGUMENTS** properly. Not a summary of the scanner's opinion — an
independent look that happens to include it.

Gather what you need:

```bash
npm run toreda -- quote $ARGUMENTS --json
npm run toreda -- portfolio --json      # do I already hold it, and at what weight?
npm run toreda -- scan --json           # did it produce a signal, and on what evidence?
```

Go further where it matters. `src/core/market-data.ts` exports `getDailyBars`,
`getNews`, `getSnapshots`; `src/scanner/` exports the scoring functions. Write a
throwaway script under the scratchpad and run it with `./node_modules/.bin/tsx`
if a question needs more than the commands give you — check the volume profile,
pull the actual headlines behind a news signal, compare the move against the
symbol's own volatility.

Then tell me:

**What it is** — the business, in a sentence. If you don't know, say so rather
than generating something plausible.

**Where it stands** — price, today's move, the move over the scanner's window,
volume against its own average. Whether I hold it, at what weight, against what
ceiling.

**The case for.** Which of the three entry criteria it actually satisfies:
price, catalyst, thesis. Name them explicitly. Two of three is the bar.

**The case against.** This section is not optional and should not be shorter
than the case for. What would have to be true for this to be a mistake? What is
the scanner's evidence *not* telling us? If a news signal drove the score, read
the actual headlines — tone counting is crude and sometimes wrong.

**What I'd need to see.** A concrete condition that would change the answer,
not "monitor the situation".

If the scanner scored it, quote the breakdown and say whether you agree with the
components. If it produced no signal, that is also information — say why not.

Do not place an order. Do not tell me to.
