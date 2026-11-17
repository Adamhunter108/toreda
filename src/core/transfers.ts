// Deposits and withdrawals, so money moved in or out is never mistaken for a
// day's gain.
//
// Everywhere toreda shows "today's change" it starts from Alpaca's
// `last_equity`: the account's equity at the previous session's close. Money
// deposited since that close is in `equity` but not in `last_equity`, so it
// lands in the difference: a deposit made during the session shows as a day up
// by nearly the amount deposited, even on a day the positions lost money. So
// the change is measured net of the cash that moved since that close.
//
// When the transfers cannot be fetched, callers get `null` and say so next to
// the figure. A day change that might contain a deposit must not be shown as
// if it were clean.

import { authHeaders, loadConfig } from "./config";
import { isDemoMode } from "./demo";
import { getJson } from "./http";

/** A cash movement from Alpaca's activity feed, reduced to what matters here. */
export interface CashActivity {
  /** CSD (deposit), CSW (withdrawal) or JNLC (cash journal). */
  type: string;
  /** As Alpaca reports it; the sign convention is handled by `signedAmount`. */
  amount: number;
  /** ISO timestamp, UTC. */
  createdAt: string;
  /** The activity's date, YYYY-MM-DD. */
  date: string;
  status: string;
}

export interface CashFlows {
  /** Money in since the previous close (a positive figure). */
  deposits: number;
  /** Money out since the previous close (a positive figure). */
  withdrawals: number;
  /** deposits − withdrawals. */
  net: number;
}

export const NO_FLOWS: CashFlows = { deposits: 0, withdrawals: 0, net: 0 };

/**
 * Deposits, withdrawals and cash journals. Not TRANS, which is an older name
 * covering CSD and CSW together and would count each transfer twice.
 */
export const FLOW_TYPES = ["CSD", "CSW", "JNLC"] as const;

const ET = "America/New_York";

/** The calendar date in New York of an instant, as YYYY-MM-DD. */
export function easternDate(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ET,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** New York's offset from UTC at an instant, in ms (−5h in winter, −4h in summer). */
function easternOffsetMs(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return wall - (at.getTime() - at.getUTCMilliseconds());
}

/**
 * A New York wall-clock time ("2026-11-16", "16:00") as a UTC instant.
 *
 * The offset depends on the date (daylight saving), so it is looked up rather
 * than assumed, and looked up twice so a time near a changeover lands right.
 */
export function easternToUtc(date: string, time: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const wall = Date.UTC(y!, m! - 1, d!, hh!, mm!);
  let t = wall;
  for (let i = 0; i < 2; i++) t = wall - easternOffsetMs(new Date(t));
  return new Date(t);
}

export interface Session {
  date: string;
  /** Closing time, New York wall clock, e.g. "16:00" or "13:00" on a half day. */
  close: string;
}

/**
 * The close of the most recent session dated before `todayEt`: the moment
 * Alpaca's `last_equity` describes ("previous trading day at 16:00 ET").
 *
 * Holidays and weekends fall out of the calendar: on a Monday this is Friday's
 * close, and after a half day it is 13:00, not 16:00.
 */
export function previousSessionClose(sessions: Session[], todayEt: string): Date | null {
  let prior: Session | undefined;
  for (const s of sessions) {
    if (s.date < todayEt && (!prior || s.date > prior.date)) prior = s;
  }
  return prior ? easternToUtc(prior.date, prior.close) : null;
}

/**
 * The amount with the direction made explicit: positive is money in.
 *
 * Deposits and withdrawals are signed by their type, whatever sign the feed
 * puts on the amount. A cash journal carries its own sign.
 */
export function signedAmount(a: CashActivity): number {
  if (a.type === "CSD") return Math.abs(a.amount);
  if (a.type === "CSW") return -Math.abs(a.amount);
  return a.amount;
}

/** Total the cash that moved after `since`. Cancelled transfers never arrived. */
export function flowsSince(activities: CashActivity[], since: Date): CashFlows {
  let deposits = 0;
  let withdrawals = 0;
  for (const a of activities) {
    if (/cancel/i.test(a.status)) continue;
    const at = Date.parse(a.createdAt);
    // No usable timestamp: fall back to the date, which can only say "a later day".
    const after = Number.isFinite(at) ? at > since.getTime() : a.date > easternDate(since);
    if (!after) continue;
    const amount = signedAmount(a);
    if (amount >= 0) deposits += amount;
    else withdrawals -= amount;
  }
  return { deposits, withdrawals, net: deposits - withdrawals };
}

/** Parse the activity feed. Anything that is not a list is an error payload. */
export function parseCashActivities(raw: unknown): CashActivity[] {
  if (!Array.isArray(raw)) {
    throw new Error(`Alpaca activities did not return a list: ${JSON.stringify(raw).slice(0, 200)}`);
  }
  return raw.map((r): CashActivity => {
    const a = r as Record<string, unknown>;
    const amount = Number(a.net_amount);
    return {
      type: String(a.activity_type ?? ""),
      amount: Number.isFinite(amount) ? amount : 0,
      createdAt: String(a.created_at ?? ""),
      date: String(a.date ?? ""),
      status: String(a.status ?? ""),
    };
  });
}

const DAY_MS = 86_400_000;

// The previous close changes once a day; the calendar is not worth re-asking
// for on every 20-second dashboard poll.
let sinceCache: { today: string; since: Date } | null = null;

async function previousCloseFor(now: Date): Promise<Date> {
  const today = easternDate(now);
  if (sinceCache?.today === today) return sinceCache.since;
  const cfg = loadConfig();
  // Ten days back covers any run of weekends and holidays.
  const from = easternDate(new Date(now.getTime() - 10 * DAY_MS));
  const raw = await getJson<unknown>(`${cfg.tradeHost}/v2/calendar?start=${from}&end=${today}`, {
    headers: authHeaders(cfg),
  });
  if (!Array.isArray(raw)) {
    throw new Error(`Alpaca /v2/calendar did not return a list: ${JSON.stringify(raw).slice(0, 200)}`);
  }
  const sessions = raw.map((r) => {
    const s = r as Record<string, unknown>;
    return { date: String(s.date ?? ""), close: String(s.close ?? "16:00") };
  });
  const since = previousSessionClose(sessions, today);
  if (!since) throw new Error(`no trading session before ${today} in the calendar`);
  sinceCache = { today, since };
  return since;
}

/**
 * Cash moved in or out since the previous close: the part of
 * `equity − last_equity` that is not a gain or a loss.
 *
 * Throws when it cannot be checked; callers turn that into a visible caveat.
 */
export async function getCashFlowsToday(now = new Date()): Promise<CashFlows> {
  if (isDemoMode()) return NO_FLOWS;
  const since = await previousCloseFor(now);
  const cfg = loadConfig();
  // A day's margin on the query; the exact cut is made against the close below.
  const after = easternDate(new Date(since.getTime() - DAY_MS));
  const raw = await getJson<unknown>(
    `${cfg.tradeHost}/v2/account/activities?activity_types=${FLOW_TYPES.join(",")}` +
      `&after=${after}&page_size=100`,
    { headers: authHeaders(cfg) },
  );
  return flowsSince(parseCashActivities(raw), since);
}

/** As `getCashFlowsToday`, but `null` instead of throwing: "could not check". */
export async function tryCashFlowsToday(now = new Date()): Promise<CashFlows | null> {
  try {
    return await getCashFlowsToday(now);
  } catch {
    return null;
  }
}

export interface DayChange {
  /** Today's gain or loss in dollars, net of transfers. */
  amount: number;
  /** As a fraction of the previous close's equity: 0.0132 is +1.32%. */
  pct: number;
  /** What was taken out of the raw difference; null if it could not be checked. */
  flows: CashFlows | null;
}

/**
 * Today's change in account equity, with deposits and withdrawals taken out.
 *
 * When `flows` is null the raw difference is returned, and the caller must
 * say that it may include transfers.
 */
export function dayChange(equity: number, lastEquity: number, flows: CashFlows | null): DayChange {
  const raw = equity - lastEquity - (flows?.net ?? 0);
  const amount = Math.abs(raw) < 0.005 ? 0 : raw;
  return { amount, pct: lastEquity ? amount / lastEquity : 0, flows };
}

function money(n: number): string {
  const whole = Math.abs(n - Math.round(n)) < 0.005;
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  })}`;
}

/**
 * The caveat to print beside a day change, or null when there is nothing to
 * say: "excl. +$1,000 deposited", or "may include transfers" when the
 * transfers could not be checked.
 */
export function describeFlows(flows: CashFlows | null): string | null {
  if (flows === null) return "may include transfers";
  const { deposits, withdrawals, net } = flows;
  if (deposits < 0.005 && withdrawals < 0.005) return null;
  if (withdrawals < 0.005) return `excl. +${money(deposits)} deposited`;
  if (deposits < 0.005) return `excl. -${money(withdrawals)} withdrawn`;
  return `excl. ${net >= 0 ? "+" : "-"}${money(Math.abs(net))} net transfers`;
}
