// Poll account and positions on a lazy timer — the SLOW path.
//
// These change only when you trade, so 20s is plenty and stays far under the
// rate limit. Live prices come from the WebSocket stream instead.
import { useEffect, useState } from "react";
import { getAccount, getPositions } from "../../core/alpaca";
import type { Account, Position } from "../../core/types";

export function useAlpaca(pollMs = 20_000) {
  const [account, setAccount] = useState<Account | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  useEffect(() => {
    let alive = true;
    async function tick(): Promise<void> {
      try {
        const [a, p] = await Promise.all([getAccount(), getPositions()]);
        if (!alive) return;
        setAccount(a);
        setPositions(p);
        setError(null);
        setUpdatedAt(new Date());
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      }
    }
    void tick();
    const id = setInterval(() => void tick(), pollMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [pollMs]);

  return { account, positions, error, updatedAt };
}
