// Small shared formatters for the dashboard.

export const usd = (n: number): string => `$${n.toFixed(2)}`;

/**
 * Snap sub-cent noise to zero.
 *
 * Without this a flat position renders as "-$0.00" and picks up the loss colour
 * — a red minus sign on a day where nothing happened. Applied at the source too,
 * so the colour and the text always agree.
 */
export const snap0 = (n: number): number => (Math.abs(n) < 0.005 ? 0 : n);

/** Compact large numbers: 1_772_167 → "1.77M". */
export function humanNum(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n);
}

export const signedUsd = (n: number): string => {
  const v = snap0(n);
  return `${v >= 0 ? "+" : "-"}$${Math.abs(v).toFixed(2)}`;
};

export const signedPct = (n: number): string => {
  const v = snap0(n);
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
};

/**
 * Share quantities, which are often fractional (0.377375…).
 *
 * Up to four decimals, trimmed, and whole numbers without a decimal point.
 */
export function fmtQty(q: number): string {
  if (Number.isInteger(q)) return String(q);
  return q.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

export const padR = (s: string, n: number): string => s.padEnd(n);
export const padL = (s: string, n: number): string => s.padStart(n);
