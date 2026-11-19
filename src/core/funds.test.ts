import { test } from "node:test";
import assert from "node:assert/strict";
import { fundsOf } from "./funds";

// The case that prompted this: a 2× margin account shows buying power of
// roughly cash plus equity, and only the cash part is money you have.
test("on a margin account, buying power past your cash is margin", () => {
  assert.deepEqual(fundsOf({ cash: 400, buyingPower: 2_400 }), { cash: 400, margin: 2_000, loan: 0 });
});

test("without margin, cash and buying power match and there is none", () => {
  assert.deepEqual(fundsOf({ cash: 400, buyingPower: 400 }), { cash: 400, margin: 0, loan: 0 });
});

// Open buy orders reserve buying power before they fill; cash moves only on
// the fill. The smaller figure is what is actually free.
test("cash never exceeds buying power", () => {
  assert.equal(fundsOf({ cash: 400, buyingPower: 150 }).cash, 150);
});

test("negative cash is a margin loan, and leaves nothing to spend", () => {
  assert.deepEqual(fundsOf({ cash: -250, buyingPower: 900 }), { cash: 0, margin: 900, loan: 250 });
});
