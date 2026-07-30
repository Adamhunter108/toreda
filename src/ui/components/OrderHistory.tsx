import * as React from "react";
import { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { getOrders, type OrderRecord } from "../../core/orders";
import { mutedProps, statusColor } from "../../core/theme";
import { padL, padR } from "../format";
import { useTheme } from "../theme/ThemeContext";

const VISIBLE = 15;

/** Read-only order history, opened with `h`. Newest first, all statuses. */
export function OrderHistory({ onClose }: { onClose: () => void }) {
  const t = useTheme();
  const [orders, setOrders] = useState<OrderRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [scroll, setScroll] = useState(0);

  function load(): void {
    setLoading(true);
    setError(null);
    getOrders(50)
      .then((o) => {
        setOrders(o);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }

  useEffect(() => {
    load();
  }, []);

  const list = orders ?? [];
  const maxScroll = Math.max(0, list.length - VISIBLE);

  useInput(
    (input, key) => {
      if (key.escape || input === "q") onClose();
      else if (input === "r") load();
      else if (key.downArrow) setScroll((s) => Math.min(maxScroll, s + 1));
      else if (key.upArrow) setScroll((s) => Math.max(0, s - 1));
    },
    { isActive: process.stdin.isTTY === true },
  );

  const start = Math.min(scroll, maxScroll);
  const view = list.slice(start, start + VISIBLE);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={t.border} paddingX={1}>
      <Text bold>
        Order history <Text {...mutedProps(t)}>{orders ? `· ${list.length} recent` : ""}</Text>
      </Text>
      {loading ? <Text color={t.warning}>loading…</Text> : null}
      {error ? <Text color={t.negative}>failed: {error}</Text> : null}
      {orders && list.length === 0 && !loading ? (
        <Text {...mutedProps(t)}>no orders on record.</Text>
      ) : null}

      {list.length > 0 ? (
        <>
          <Text {...mutedProps(t)}>
            {"  "}
            {padR("DATE", 11)}
            {padR("SIDE", 5)}
            {padL("QTY", 11)}
            {"  "}
            {padR("SYM", 6)}
            {padR("TYPE", 7)}
            {padL("FILL", 9)}
            {"  STATUS"}
          </Text>
          <Text {...mutedProps(t)}>{start > 0 ? " ↑ more…" : " "}</Text>
          {view.map((o) => {
            const date = o.submittedAt.slice(0, 10);
            // Notional orders carry no qty, only a filled quantity.
            const qty = o.qty || o.filledQty;
            const fill = o.filledAvgPrice ? `$${Number(o.filledAvgPrice).toFixed(2)}` : "—";
            return (
              <Box key={o.id}>
                <Text {...mutedProps(t)}>{"  " + padR(date, 11)}</Text>
                <Text color={o.side === "buy" ? t.positive : t.negative}>
                  {padR(o.side.toUpperCase(), 5)}
                </Text>
                <Text>{padL(qty, 11)}</Text>
                <Text>{"  " + padR(o.symbol, 6)}</Text>
                <Text {...mutedProps(t)}>{padR(o.type, 7)}</Text>
                <Text>{padL(fill, 9)}</Text>
                <Text color={statusColor(t, o.status)}>{"  " + o.status}</Text>
              </Box>
            );
          })}
          <Text {...mutedProps(t)}>
            {start + VISIBLE < list.length ? ` ↓ ${list.length - start - VISIBLE} more…` : " "}
          </Text>
        </>
      ) : null}

      <Text {...mutedProps(t)}>{"\n"}↑↓ scroll · r refresh · esc back</Text>
    </Box>
  );
}
