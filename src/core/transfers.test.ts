import { test } from "node:test";
import assert from "node:assert/strict";
import {
  type CashActivity,
  dayChange,
  describeFlows,
  easternDate,
  easternToUtc,
  flowsSince,
  NO_FLOWS,
  parseCashActivities,
  previousSessionClose,
} from "./transfers";

const act = (over: Partial<CashActivity>): CashActivity => ({
  type: "CSD",
  amount: 1000,
  createdAt: "2026-02-10T15:30:12.345678Z",
  date: "2026-02-10",
  status: "executed",
  ...over,
});

const week = [
  { date: "2026-02-05", close: "16:00" },
  { date: "2026-02-06", close: "16:00" },
  { date: "2026-02-09", close: "16:00" },
  { date: "2026-02-10", close: "16:00" },
];

test("New York wall-clock times convert with the right offset either side of DST", () => {
  assert.equal(easternToUtc("2026-02-09", "16:00").toISOString(), "2026-02-09T21:00:00.000Z");
  assert.equal(easternToUtc("2026-07-16", "16:00").toISOString(), "2026-07-16T20:00:00.000Z");
});

test("the New York date lags UTC in the evening", () => {
  assert.equal(easternDate(new Date("2026-02-10T03:00:00Z")), "2026-02-09");
  assert.equal(easternDate(new Date("2026-02-10T15:30:12Z")), "2026-02-10");
});

test("the basis is the previous session's close, not today's", () => {
  const since = previousSessionClose(week, "2026-02-10");
  assert.equal(since?.toISOString(), "2026-02-09T21:00:00.000Z");
});

test("on a Monday the basis is Friday's close", () => {
  const since = previousSessionClose(week, "2026-02-09");
  assert.equal(since?.toISOString(), "2026-02-06T21:00:00.000Z");
});

test("after a half day the basis is the early close", () => {
  const sessions = [
    { date: "2026-11-25", close: "16:00" },
    { date: "2026-11-27", close: "13:00" },
    { date: "2026-11-30", close: "16:00" },
  ];
  assert.equal(previousSessionClose(sessions, "2026-11-30")?.toISOString(), "2026-11-27T18:00:00.000Z");
});

test("no earlier session means no basis", () => {
  assert.equal(previousSessionClose(week, "2026-02-05"), null);
});

// $1,000 deposited at 10:30 ET on a Tuesday.
test("today's deposit is counted", () => {
  const since = previousSessionClose(week, "2026-02-10")!;
  assert.deepEqual(flowsSince([act({})], since), { deposits: 1000, withdrawals: 0, net: 1000 });
});

test("money that arrived before the previous close is already in last_equity", () => {
  const since = previousSessionClose(week, "2026-02-10")!;
  const earlier = act({ createdAt: "2026-02-09T18:00:00Z", date: "2026-02-09" }); // 13:00 ET Monday
  assert.deepEqual(flowsSince([earlier], since), NO_FLOWS);
  const afterClose = act({ createdAt: "2026-02-09T23:30:00Z", date: "2026-02-09" }); // 18:30 ET Monday
  assert.equal(flowsSince([afterClose], since).net, 1000);
});

test("Monday counts a weekend deposit but not Friday's", () => {
  const since = previousSessionClose(week, "2026-02-09")!;
  const friday = act({ createdAt: "2026-02-06T15:00:00Z", date: "2026-02-06", amount: 400 });
  const saturday = act({ createdAt: "2026-02-07T15:00:00Z", date: "2026-02-07", amount: 600 });
  assert.deepEqual(flowsSince([friday, saturday], since), { deposits: 600, withdrawals: 0, net: 600 });
});

test("a withdrawal is money out whichever sign the feed gives it", () => {
  const since = previousSessionClose(week, "2026-02-10")!;
  for (const amount of [-200, 200]) {
    assert.deepEqual(flowsSince([act({ type: "CSW", amount })], since), {
      deposits: 0,
      withdrawals: 200,
      net: -200,
    });
  }
});

test("cash journals carry their own sign, and cancelled transfers never arrived", () => {
  const since = previousSessionClose(week, "2026-02-10")!;
  const flows = flowsSince(
    [
      act({ type: "JNLC", amount: 50 }),
      act({ type: "JNLC", amount: -20 }),
      act({ amount: 999, status: "canceled" }),
    ],
    since,
  );
  assert.deepEqual(flows, { deposits: 50, withdrawals: 20, net: 30 });
});

test("an activity with no timestamp falls back to its date", () => {
  const since = previousSessionClose(week, "2026-02-10")!;
  assert.equal(flowsSince([act({ createdAt: "" })], since).net, 1000);
  assert.equal(flowsSince([act({ createdAt: "", date: "2026-02-09" })], since).net, 0);
});

test("the activity feed parses, and a non-list is an error", () => {
  const parsed = parseCashActivities([
    { activity_type: "CSD", net_amount: "1000", created_at: "2026-02-10T15:30:12Z", date: "2026-02-10", status: "executed" },
  ]);
  assert.deepEqual(parsed, [act({ createdAt: "2026-02-10T15:30:12Z" })]);
  assert.throws(() => parseCashActivities({ message: "forbidden" }));
});

// A $1,000 deposit on a day the positions lost $40.
test("the day change takes the deposit out", () => {
  const flows = { deposits: 1000, withdrawals: 0, net: 1000 };
  const d = dayChange(4960, 4000, flows);
  assert.ok(Math.abs(d.amount - -40) < 1e-9, String(d.amount));
  assert.ok(Math.abs(d.pct - -0.01) < 1e-12);
  assert.equal(d.flows, flows);
});

test("unknown transfers leave the raw difference, flagged by a null", () => {
  const d = dayChange(4960, 4000, null);
  assert.ok(Math.abs(d.amount - 960) < 1e-9);
  assert.equal(d.flows, null);
});

test("a zero previous equity does not divide by zero", () => {
  assert.equal(dayChange(1000, 0, { deposits: 1000, withdrawals: 0, net: 1000 }).pct, 0);
});

test("the caveat says what was taken out, or that it could not be checked", () => {
  assert.equal(describeFlows(NO_FLOWS), null);
  assert.equal(describeFlows({ deposits: 1000, withdrawals: 0, net: 1000 }), "excl. +$1,000 deposited");
  assert.equal(describeFlows({ deposits: 0, withdrawals: 250.5, net: -250.5 }), "excl. -$250.50 withdrawn");
  assert.equal(describeFlows({ deposits: 1000, withdrawals: 200, net: 800 }), "excl. +$800 net transfers");
  assert.equal(describeFlows(null), "may include transfers");
});
