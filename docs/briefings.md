# Briefings

**This feature is optional and toreda is complete without it.** Nothing else
depends on it. If scheduled market summaries don't appeal, skip this file
entirely.

A briefing is a portfolio summary, a positions table, and — optionally — a few
lines of written commentary.

---

## Try one now

```bash
npm run toreda -- brief
```

No configuration, no setup, no accounts. It prints to your terminal:

```
📊 Market Open — 07/28/2026, 09:31 AM EDT
Portfolio $100,818.77 | Day +$32.01 (+0.03%) | BP $398,789.46

SYM    VALUE     DAY    P&L     TOT
-----------------------------------
AAPL   3,738  +0.86%   +819  +28.0%
-----------------------------------
TOT    3,738           +819
```

`brief close` gives the end-of-day version, which skips the opportunity scan.

**`DAY` and `TOT` answer different questions.** `DAY` is that position's move
today; `TOT` is lifetime unrealized P&L since entry. A flat day on a position up
28% is a flat day.

---

## Where briefings can go

Four channels, all independent. None is a prerequisite for any other, and you
can combine them freely.

| Channel | Flag | Needs |
|---|---|---|
| Terminal | *(default)* | nothing |
| A log file | `--out FILE` | nothing |
| Desktop notification | `--notify` | nothing |
| Telegram | `--telegram` | a bot, see below |

```bash
npm run toreda -- brief --out journal/briefings.log
npm run toreda -- brief close --notify
npm run toreda -- brief --out journal/briefings.log --telegram
```

`--quiet` suppresses the terminal copy when you only want the other channels.

---

## Telegram

Only needed if you want briefings on your phone.

```bash
npm run toreda -- setup briefings
```

It walks you through it:

1. **Create a bot.** Message [@BotFather](https://t.me/BotFather) on Telegram,
   send `/newbot`, follow the prompts. It replies with a token.
2. **Paste the token.** toreda verifies it and tells you which bot it connected
   to.
3. **Send your bot any message.** toreda watches for it and reads your chat ID
   automatically — no JSON to hand-parse.
4. **A test message arrives**, so you know it works rather than hoping.

Credentials are written to `.env`, which is gitignored and `chmod 600`.

<details>
<summary>Setting it up by hand</summary>

Put both values in `.env`:

```
TELEGRAM_BOT_TOKEN=123456789:AAE...
TELEGRAM_CHAT_ID=987654321
```

To find your chat ID manually: message the bot, then open
`https://api.telegram.org/bot<TOKEN>/getUpdates` and read
`result[0].message.chat.id`. The wizard exists to spare you this.
</details>

---

## Written commentary

Without it, briefings carry the numbers alone — which is a complete briefing.

With a Claude Code subscription, they can also carry a few lines of written
analysis. Generate a token:

```bash
claude setup-token
```

Paste the `sk-ant-oat...` value into `.env` as `CLAUDE_CODE_OAUTH_TOKEN`, or let
`setup briefings` do it. This uses your subscription, not API billing.

If the token is missing or expired, the briefing still sends and says
`note: no CLAUDE_CODE_OAUTH_TOKEN — sending data without commentary`. Losing the
commentary must never cost you the positions table.

---

## Scheduling

Also optional, and separate from everything above.

```bash
npm run toreda -- schedule install --dry-run   # show what it would write
npm run toreda -- schedule install             # actually install
npm run toreda -- schedule status
npm run toreda -- schedule uninstall
```

Installs two weekday jobs — market open and five minutes after the close.

| Platform | Mechanism |
|---|---|
| macOS | launchd user agent in `~/Library/LaunchAgents` |
| Linux | systemd user timer, or a cron line if systemd is absent |
| Windows | Task Scheduler via `schtasks` |

**`--dry-run` prints the exact file or command first.** Worth using — this is a
command that changes your machine.

### Times are converted for you

Schedulers work in local time; the market does not. toreda converts
`09:30 America/New_York` into your local clock at install time and tells you what
it chose:

```
open   market 09:30 New York  →  14:30 your local time, weekdays
close  market 16:05 New York  →  21:05 your local time, weekdays
```

Without this a user in London would get their "market open" briefing at 09:30
GMT — four and a half hours early, quoting the previous session's prices.

**Daylight saving will shift this.** US and European transitions are weeks apart,
and some zones observe none at all, so a schedule correct in July can be an hour
off in late March. toreda warns when it detects the drift:

```
⚠ daylight saving will shift this: 22:30 now, 23:30 in six months.
  Re-run `toreda schedule install` after a clock change.
```

Re-running `install` recalculates and replaces the existing jobs.

As a backstop, a briefing that runs while the market is closed says so rather
than presenting stale prices as current.

---

## When a briefing fails

A briefing built on missing data is worse than no briefing: a blank positions
table reads as "no positions" and gets acted on. So toreda validates the Alpaca
response before formatting anything, and a fetch failure **aborts loudly**
instead of rendering an empty table.

A genuinely empty account states it in words — `(no open positions — account is
genuinely flat)` — because by the time the text reaches you, an empty table and
a failed fetch look identical.

If the failure alert itself can't be delivered — likely, since it travels the
same network that just failed — it's queued to disk and delivered by the next
successful run, and a desktop notification is raised locally. **A failure report
must not depend on the thing it is reporting on.**

---

## Logs

Scheduled runs write to `logs/briefing.log` and `logs/briefing.err.log`. Both are
gitignored. If a scheduled briefing doesn't arrive, the error log is the first
place to look.
