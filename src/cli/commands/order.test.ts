import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "../args";
import { parseOrderArgs } from "./order";

/** Parse a command line exactly as the dispatcher does: argv → args → order. */
function parse(line: string) {
  return parseOrderArgs(parseArgs(line.split(" ").filter(Boolean)));
}

test("a market buy parses", () => {
  const r = parse("order NVDA buy 5");
  assert.notEqual(typeof r, "string");
  if (typeof r === "string") return;
  assert.equal(r.request.symbol, "NVDA");
  assert.equal(r.request.side, "buy");
  assert.equal(r.request.qty, "5");
  assert.equal(r.request.type, "market");
});

// THE safety property of this entire command. Without --confirm, nothing is
// ever transmitted, no matter what else is on the line.
test("confirm is false unless --confirm is present", () => {
  const r = parse("order NVDA buy 5");
  if (typeof r === "string") throw new Error(r);
  assert.equal(r.confirm, false);
});

test("--confirm is recognised at the end", () => {
  const r = parse("order NVDA buy 5 --confirm");
  if (typeof r === "string") throw new Error(r);
  assert.equal(r.confirm, true);
});

// Flag position must not change meaning: a user who types the flag early and
// the quantity late must get the same order, and the symbol must survive.
test("--confirm is recognised in the middle without eating the next token", () => {
  const r = parse("order NVDA buy --confirm 5");
  if (typeof r === "string") throw new Error(r);
  assert.equal(r.confirm, true);
  assert.equal(r.request.qty, "5");
  assert.equal(r.request.symbol, "NVDA");
});

// A deliberate divergence from the bash original, which accepted a bare
// `confirm` as equivalent to `--confirm`. A positional word that transmits real
// money is too easy to produce by accident — a stray shell token, a mistyped
// order type. Here it is a hard error, so nothing is sent AND the user is told
// why, rather than the word being silently ignored.
test("a bare 'confirm' word is rejected outright, never treated as confirmation", () => {
  const r = parse("order NVDA buy 5 confirm");
  assert.equal(typeof r, "string", "bare 'confirm' must not parse into an order");
  assert.match(r as string, /must be 'market' or 'limit'/);
  assert.match(r as string, /--confirm/); // the usage text points at the right form
});

test("symbols are upper-cased", () => {
  const r = parse("order nvda buy 5");
  if (typeof r === "string") throw new Error(r);
  assert.equal(r.request.symbol, "NVDA");
});

test("a limit order captures its price", () => {
  const r = parse("order NVDA sell 5 limit 180.00 --confirm");
  if (typeof r === "string") throw new Error(r);
  assert.equal(r.request.type, "limit");
  assert.equal(r.request.limitPrice, "180.00");
  assert.equal(r.request.side, "sell");
  assert.equal(r.confirm, true);
});

test("a limit order without a price is rejected", () => {
  const r = parse("order NVDA buy 5 limit");
  assert.equal(typeof r, "string");
  assert.match(r as string, /needs a price/);
});

test("a limit order with a zero price is rejected", () => {
  assert.match(parse("order NVDA buy 5 limit 0") as string, /needs a price/);
});

test("an invalid side is rejected", () => {
  const r = parse("order NVDA long 5");
  assert.equal(typeof r, "string");
  assert.match(r as string, /must be 'buy' or 'sell'/);
});

test("an invalid order type is rejected rather than silently treated as market", () => {
  const r = parse("order NVDA buy 5 stop 180");
  assert.equal(typeof r, "string");
  assert.match(r as string, /must be 'market' or 'limit'/);
});

test("zero, negative, and non-numeric quantities are rejected", () => {
  for (const q of ["0", "-5", "abc"]) {
    const r = parse(`order NVDA buy ${q}`);
    assert.equal(typeof r, "string", `expected ${q} to be rejected`);
    assert.match(r as string, /positive number/);
  }
});

test("fractional quantities are allowed and keep their precision as a string", () => {
  const r = parse("order NVDA buy 0.377");
  if (typeof r === "string") throw new Error(r);
  // Kept as a string deliberately — a float round-trip can change the value
  // Alpaca receives.
  assert.equal(r.request.qty, "0.377");
});

test("missing arguments produce usage, not a partial order", () => {
  assert.match(parse("order") as string, /Usage/);
  assert.match(parse("order NVDA") as string, /Usage/);
  assert.match(parse("order NVDA buy") as string, /Usage/);
});

test("shorting requires an explicit opt-in flag", () => {
  const plain = parse("order NVDA sell 5");
  if (typeof plain === "string") throw new Error(plain);
  assert.equal(plain.allowShort, false);

  const opted = parse("order NVDA sell 5 --allow-short");
  if (typeof opted === "string") throw new Error(opted);
  assert.equal(opted.allowShort, true);
});
