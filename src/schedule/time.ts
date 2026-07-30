// Converting market time to the time a scheduler actually understands.
//
// The source project's launchd jobs fired at "09:30" — LOCAL time. That is
// correct on a Mac set to US Eastern and wrong everywhere else: a user in London
// would get their "market open" briefing at 09:30 GMT, four and a half hours
// before the open, reporting the previous session's prices as though they were
// today's.
//
// Schedulers on every platform work in local time, so the conversion has to
// happen when the schedule is INSTALLED. That leaves a second problem, handled
// by `dstDriftWarning` below: US and EU daylight-saving transitions are weeks
// apart, so a schedule correct in July can be an hour off in late March.

export const MARKET_TIMEZONE = "America/New_York";

/** Market open, in market time. */
export const MARKET_OPEN = { hour: 9, minute: 30 };

/**
 * Market close briefing, five minutes after the 16:00 bell.
 *
 * Deliberately after, not at: closing prints settle in the final seconds, and a
 * briefing built at exactly 16:00 quotes numbers that move immediately after.
 */
export const MARKET_CLOSE = { hour: 16, minute: 5 };

/**
 * The offset of `timeZone` from UTC at a given instant, in milliseconds.
 *
 * Derived by formatting the instant in that zone and reading the wall clock
 * back, which is the only approach that handles daylight saving without a
 * timezone database of our own.
 */
export function zoneOffsetMs(instant: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(instant)) parts[part.type] = part.value;

  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    // Intl can render midnight as hour 24 under some locale/hour-cycle combos.
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - instant.getTime();
}

/**
 * The instant at which it is `hour:minute` wall-clock time in `timeZone`, on the
 * calendar day `on` falls in (in that zone).
 *
 * Two passes: the first guess uses the offset at `on`, the second corrects for a
 * daylight-saving change between `on` and the target time.
 */
export function wallTimeToInstant(
  hour: number,
  minute: number,
  timeZone: string,
  on: Date = new Date(),
): Date {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [year, month, day] = formatter.format(on).split("-").map(Number);
  const naiveUtc = Date.UTC(year!, month! - 1, day!, hour, minute, 0);

  let instant = new Date(naiveUtc - zoneOffsetMs(on, timeZone));
  // Re-resolve using the offset actually in force at the guessed instant.
  instant = new Date(naiveUtc - zoneOffsetMs(instant, timeZone));
  return instant;
}

export interface ClockTime {
  hour: number;
  minute: number;
}

/**
 * Market time expressed in another zone's wall clock.
 *
 * With no `targetZone`, converts to this machine's local time — which is what a
 * scheduler needs.
 */
export function marketTimeIn(
  marketTime: ClockTime,
  targetZone?: string,
  on: Date = new Date(),
): ClockTime {
  const instant = wallTimeToInstant(marketTime.hour, marketTime.minute, MARKET_TIMEZONE, on);

  if (!targetZone) {
    return { hour: instant.getHours(), minute: instant.getMinutes() };
  }

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: targetZone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(instant)) parts[part.type] = part.value;
  return { hour: Number(parts.hour) % 24, minute: Number(parts.minute) };
}

export function formatClock({ hour, minute }: ClockTime): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * Will this local time still be correct in six months?
 *
 * Returns a warning when the market-to-local conversion differs at another point
 * in the year, which happens whenever the two zones' daylight-saving rules do
 * not align — most of the world versus the US, and everywhere that observes no
 * DST at all against a US market that does.
 */
export function dstDriftWarning(
  marketTime: ClockTime,
  targetZone?: string,
  on: Date = new Date(),
): string | null {
  const now = marketTimeIn(marketTime, targetZone, on);
  // Six months out lands in the opposite DST regime for both hemispheres.
  const later = new Date(on.getTime());
  later.setMonth(later.getMonth() + 6);
  const then = marketTimeIn(marketTime, targetZone, later);

  if (now.hour === then.hour && now.minute === then.minute) return null;
  return (
    `daylight saving will shift this: ${formatClock(now)} now, ` +
    `${formatClock(then)} in six months. Re-run \`toreda schedule install\` after a clock change.`
  );
}
