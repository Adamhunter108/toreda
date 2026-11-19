// Cash versus buying power.
//
// On a margin account, Alpaca's `buying_power` is not money you have. It is
// your cash PLUS what Alpaca would lend you against the stocks you hold. At
// the standard 2× (switched on once equity reaches $2,000) that works out to
// roughly cash plus your whole equity again, so an account with $500 of cash
// can show $2,500 of "buying power".
//
// Every buy past your cash is a loan: charged interest, and if prices fall far
// enough Alpaca can sell your positions to repay it, without asking. So
// toreda shows cash as the amount available to spend, names margin separately,
// and warns when an order would borrow.

export interface Funds {
  /** What a buy can spend without borrowing. Never negative. */
  cash: number;
  /** What Alpaca would lend on top of that: the rest of buying power. */
  margin: number;
  /** Already borrowed. Cash below zero is a margin loan. */
  loan: number;
}

/**
 * Split an account's buying power into cash and margin.
 *
 * Cash is capped at buying power because open buy orders reserve buying power
 * while cash only moves on a fill; on a 1× account, buying power is the better
 * figure for what is left. (On a 2× account a pending buy can still make cash
 * overstate what is free, by up to the size of that order.)
 */
export function fundsOf(account: { cash: number; buyingPower: number }): Funds {
  const cash = Math.max(0, Math.min(account.cash, account.buyingPower));
  return {
    cash,
    margin: Math.max(0, account.buyingPower - cash),
    loan: Math.max(0, -account.cash),
  };
}
