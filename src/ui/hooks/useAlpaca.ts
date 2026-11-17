// Poll account and positions on a lazy timer — the SLOW path.
//
// These change only when you trade, so 20s is plenty and stays far under the
// rate limit. Live prices come from the WebSocket stream instead.
//
// Except right after you DO trade: `refresh()` polls immediately, so a filled
// order shows up in the positions table now rather than up to 20s later — a
// window in which the dashboard says you still hold what you just sold.
//
// Deposits and withdrawals since the previous close are fetched with the
// account, so the day change and its correction always arrive together. A
// failure there is `null` — "could not check" — never a reason to drop the
// account itself.
import { useCallback, useEffect, useRef, useState } from "react";
import { getAccount, getPositions } from "../../core/alpaca";
import { type CashFlows, tryCashFlowsToday } from "../../core/transfers";
import type { Account, Position } from "../../core/types";

export function useAlpaca(pollMs = 20_000) {
  const [account, setAccount] = useState<Account | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [flows, setFlows] = useState<CashFlows | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const tickRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    let alive = true;
    async function tick(): Promise<void> {
      try {
        const [a, p, f] = await Promise.all([getAccount(), getPositions(), tryCashFlowsToday()]);
        if (!alive) return;
        setAccount(a);
        setPositions(p);
        setFlows(f);
        setError(null);
        setUpdatedAt(new Date());
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      }
    }
    tickRef.current = tick;
    void tick();
    const id = setInterval(() => void tick(), pollMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [pollMs]);

  const refresh = useCallback(() => void tickRef.current(), []);

  return { account, positions, flows, error, updatedAt, refresh };
}
