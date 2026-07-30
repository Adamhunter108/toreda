import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dstDriftWarning,
  formatClock,
  MARKET_CLOSE,
  MARKET_OPEN,
  MARKET_TIMEZONE,
  marketTimeIn,
  wallTimeToInstant,
  zoneOffsetMs,
} from "./time";

// July: US Eastern is EDT (UTC-4), London is BST (UTC+1), Tokyo is UTC+9.
const SUMMER = new Date("2026-07-15T12:00:00Z");
// January: US Eastern is EST (UTC-5), London is GMT (UTC+0), Tokyo is UTC+9.
const WINTER = new Date("2026-01-15T12:00:00Z");

test("zone offsets follow daylight saving", () => {
  assert.equal(zoneOffsetMs(SUMMER, MARKET_TIMEZONE) / 3_600_000, -4);
  assert.equal(zoneOffsetMs(WINTER, MARKET_TIMEZONE) / 3_600_000, -5);
  assert.equal(zoneOffsetMs(SUMMER, "Europe/London") / 3_600_000, 1);
  assert.equal(zoneOffsetMs(WINTER, "Europe/London") / 3_600_000, 0);
  // A zone with no DST at all.
  assert.equal(zoneOffsetMs(SUMMER, "Asia/Tokyo") / 3_600_000, 9);
  assert.equal(zoneOffsetMs(WINTER, "Asia/Tokyo") / 3_600_000, 9);
});

test("09:30 Eastern in July is 13:30 UTC", () => {
  const instant = wallTimeToInstant(9, 30, MARKET_TIMEZONE, SUMMER);
  assert.equal(instant.toISOString(), "2026-07-15T13:30:00.000Z");
});

test("09:30 Eastern in January is 14:30 UTC", () => {
  const instant = wallTimeToInstant(9, 30, MARKET_TIMEZONE, WINTER);
  assert.equal(instant.toISOString(), "2026-01-15T14:30:00.000Z");
});

// THE bug this module exists for. A schedule that fires at 09:30 local sends a
// London user their "market open" briefing four and a half hours early.
test("market open converts correctly across zones in summer", () => {
  assert.deepEqual(marketTimeIn(MARKET_OPEN, "America/New_York", SUMMER), { hour: 9, minute: 30 });
  assert.deepEqual(marketTimeIn(MARKET_OPEN, "Europe/London", SUMMER), { hour: 14, minute: 30 });
  assert.deepEqual(marketTimeIn(MARKET_OPEN, "America/Los_Angeles", SUMMER), { hour: 6, minute: 30 });
  assert.deepEqual(marketTimeIn(MARKET_OPEN, "Asia/Tokyo", SUMMER), { hour: 22, minute: 30 });
});

test("market open converts correctly across zones in winter", () => {
  assert.deepEqual(marketTimeIn(MARKET_OPEN, "America/New_York", WINTER), { hour: 9, minute: 30 });
  assert.deepEqual(marketTimeIn(MARKET_OPEN, "Europe/London", WINTER), { hour: 14, minute: 30 });
  assert.deepEqual(marketTimeIn(MARKET_OPEN, "Asia/Tokyo", WINTER), { hour: 23, minute: 30 });
});

test("the close briefing lands after the bell, not on it", () => {
  assert.deepEqual(marketTimeIn(MARKET_CLOSE, "America/New_York", SUMMER), { hour: 16, minute: 5 });
  assert.ok(MARKET_CLOSE.minute > 0, "closing prints settle in the final seconds");
});

test("a zone crossing midnight still produces a valid clock time", () => {
  const tokyo = marketTimeIn(MARKET_CLOSE, "Asia/Tokyo", SUMMER); // 16:05 ET = 05:05 next day
  assert.ok(tokyo.hour >= 0 && tokyo.hour <= 23, `hour out of range: ${tokyo.hour}`);
  assert.deepEqual(tokyo, { hour: 5, minute: 5 });
});

test("formatClock zero-pads both halves", () => {
  assert.equal(formatClock({ hour: 9, minute: 30 }), "09:30");
  assert.equal(formatClock({ hour: 16, minute: 5 }), "16:05");
  assert.equal(formatClock({ hour: 0, minute: 0 }), "00:00");
});

// ── DST drift ───────────────────────────────────────────────────────────────

test("a zone sharing US DST rules produces no drift warning", () => {
  assert.equal(dstDriftWarning(MARKET_OPEN, "America/New_York", SUMMER), null);
  assert.equal(dstDriftWarning(MARKET_OPEN, "America/Los_Angeles", SUMMER), null);
});

// Tokyo observes no DST, so a US clock change moves the local briefing time.
// Silently letting that drift is how a schedule quietly becomes an hour wrong.
test("a zone without DST is warned about", () => {
  const warning = dstDriftWarning(MARKET_OPEN, "Asia/Tokyo", SUMMER);
  assert.ok(warning, "expected a drift warning for a non-DST zone");
  assert.match(warning, /22:30/);
  assert.match(warning, /23:30/);
  assert.match(warning, /schedule install/);
});

test("the warning names both times so the change is legible", () => {
  const warning = dstDriftWarning(MARKET_CLOSE, "Asia/Tokyo", WINTER);
  assert.ok(warning);
  assert.match(warning, /\d{2}:\d{2} now/);
  assert.match(warning, /\d{2}:\d{2} in six months/);
});
