import * as React from "react";
import { useEffect, useState } from "react";
import { basename } from "node:path";
import { Box, Text, useInput } from "ink";
import type { Mode } from "../../core/config";
import { fundsOf } from "../../core/funds";
import { appendJournal, formatTradeEntry, type JournalWrite } from "../../core/journal";
import { getLatestPrice } from "../../core/market-data";
import {
  assessOrder,
  logOrder,
  placeOrder,
  type OrderRequest,
  type OrderResult,
} from "../../core/orders";
import { maxWeightFor, type RiskRules } from "../../core/risk";
import { mutedProps } from "../../core/theme";
import type { Position } from "../../core/types";
import { usd } from "../format";
import { useTheme } from "../theme/ThemeContext";

type Stage = "edit" | "confirm" | "placing" | "done";
type Side = "buy" | "sell";
type OType = "market" | "limit";

/** Free text for the reasoning fields: anything printable, pasted text included. */
const PRINTABLE = /^[^\x00-\x1f\x7f]+$/;

/**
 * Order entry. Opened only when trading is ARMED.
 *
 * Preview-first with risk checks, and placing requires TYPING THE TICKER, so no
 * single keystroke can ever send an order. That is the same asymmetry the CLI
 * uses with `--confirm`: the safe thing is what happens when you are unsure.
 *
 * "Why" and "Wrong if" are optional, and go to journal/YYYY-MM.md when the
 * order is accepted — written at the moment of decision, before the outcome
 * is known, which is the only time that record is worth anything. Optional
 * because a required essay per trade trains people to type "x"; recorded
 * either way, because "no reason written down" is itself worth seeing later.
 */
export function OrderTicket({
  initialSymbol,
  positions,
  prices,
  account,
  risk,
  mode,
  onClose,
  onPlaced,
}: {
  initialSymbol: string;
  positions: Position[];
  prices: Record<string, number>;
  account: { equity: number; buyingPower: number; cash: number } | null;
  risk: RiskRules;
  mode: Mode;
  onClose: () => void;
  onPlaced: () => void;
}) {
  const theme = useTheme();
  const [symbol, setSymbol] = useState(initialSymbol.toUpperCase());
  const [side, setSide] = useState<Side>("buy");
  const [qty, setQty] = useState("");
  const [otype, setOtype] = useState<OType>("market");
  const [limitPrice, setLimitPrice] = useState("");
  const [focus, setFocus] = useState(0);
  const [stage, setStage] = useState<Stage>("edit");
  const [buffer, setBuffer] = useState("");
  const [result, setResult] = useState<OrderResult | null>(null);
  const [fetchedPrice, setFetchedPrice] = useState<number | undefined>(undefined);
  const [fetchingPrice, setFetchingPrice] = useState(false);
  // Until the symbol field is touched, the first keystroke REPLACES the
  // pre-filled ticker rather than appending to it.
  const [symbolTouched, setSymbolTouched] = useState(false);
  const [why, setWhy] = useState("");
  const [wrongIf, setWrongIf] = useState("");
  const [journal, setJournal] = useState<JournalWrite | null>(null);

  const sym = symbol.toUpperCase();
  const pos = positions.find((p) => p.symbol === sym);
  const heldQty = pos?.qty ?? 0;
  const streamed = prices[sym];
  const heldPrice = pos?.currentPrice;

  // If the symbol is neither streamed nor held, fetch a quote (debounced) so a
  // buy is never priced blind. No fetch fires while a partial ticker is typed.
  useEffect(() => {
    if (streamed !== undefined || heldPrice !== undefined || !sym) {
      setFetchedPrice(undefined);
      setFetchingPrice(false);
      return;
    }
    let alive = true;
    setFetchingPrice(true);
    const timer = setTimeout(() => {
      getLatestPrice(sym)
        .then((p) => {
          if (alive) {
            setFetchedPrice(p || undefined);
            setFetchingPrice(false);
          }
        })
        .catch(() => {
          if (alive) setFetchingPrice(false);
        });
    }, 450);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [sym, streamed, heldPrice]);

  const price = streamed ?? heldPrice ?? fetchedPrice ?? 0;
  const req: OrderRequest = {
    symbol: sym,
    side,
    qty,
    type: otype,
    ...(otype === "limit" ? { limitPrice } : {}),
  };
  const funds = fundsOf(account ?? { cash: 0, buyingPower: 0 });
  const assessment = assessOrder(req, {
    equity: account?.equity ?? 0,
    buyingPower: account?.buyingPower ?? 0,
    cash: funds.cash,
    heldQty,
    heldValue: heldQty * price,
    price,
    maxWeight: maxWeightFor(sym, risk),
  });
  const canReview = assessment.blocks.length === 0;

  interface Field {
    label: string;
    kind: "text" | "choice";
    display: string;
    hint?: string;
    accept?: (c: string) => boolean;
    append?: (c: string) => void;
    backspace?: () => void;
    toggle?: () => void;
  }

  const fields: Field[] = [
    {
      label: "Symbol",
      kind: "text",
      display: symbol || "—",
      hint: "(type a ticker)",
      accept: (ch) => /^[A-Za-z.]$/.test(ch),
      append: (ch) => {
        setSymbol((v) => (symbolTouched ? v + ch : ch).toUpperCase().slice(0, 8));
        setSymbolTouched(true);
      },
      backspace: () => {
        setSymbol((v) => v.slice(0, -1));
        setSymbolTouched(true);
      },
    },
    {
      label: "Side",
      kind: "choice",
      display: side.toUpperCase(),
      toggle: () => setSide((s) => (s === "buy" ? "sell" : "buy")),
    },
    {
      label: "Quantity",
      kind: "text",
      display: qty || "—",
      accept: (ch) => /^[0-9.]$/.test(ch),
      append: (ch) => setQty((v) => (v + ch).slice(0, 12)),
      backspace: () => setQty((v) => v.slice(0, -1)),
    },
    {
      label: "Type",
      kind: "choice",
      display: otype,
      toggle: () => setOtype((v) => (v === "market" ? "limit" : "market")),
    },
    ...(otype === "limit"
      ? [
          {
            label: "Limit price",
            kind: "text" as const,
            display: limitPrice || "—",
            accept: (ch: string) => /^[0-9.]$/.test(ch),
            append: (ch: string) => setLimitPrice((v) => (v + ch).slice(0, 12)),
            backspace: () => setLimitPrice((v) => v.slice(0, -1)),
          },
        ]
      : []),
    {
      label: "Why",
      kind: "text",
      display: why || "—",
      hint: "(optional · goes in your journal)",
      accept: (ch) => PRINTABLE.test(ch),
      append: (ch) => setWhy((v) => (v + ch).slice(0, 300)),
      backspace: () => setWhy((v) => v.slice(0, -1)),
    },
    {
      label: "Wrong if",
      kind: "text",
      display: wrongIf || "—",
      hint: "(optional · what would prove this a mistake)",
      accept: (ch) => PRINTABLE.test(ch),
      append: (ch) => setWrongIf((v) => (v + ch).slice(0, 300)),
      backspace: () => setWrongIf((v) => v.slice(0, -1)),
    },
  ];
  const foc = Math.min(focus, fields.length - 1);

  function doPlace(): void {
    setStage("placing");
    placeOrder(req).then((r) => {
      logOrder(req, r, mode);
      // Only an accepted order is a trade worth reasoning about; a rejected
      // one is already in orders.log with its error.
      if (r.ok) {
        setJournal(
          appendJournal(
            formatTradeEntry({ ...req, price, mode, why, wrongIf }),
          ),
        );
        onPlaced();
      }
      setResult(r);
      setStage("done");
    });
  }

  useInput(
    (input, key) => {
      if (stage === "placing") return;

      if (stage === "done") {
        if (key.return || key.escape) onClose();
        return;
      }

      if (stage === "confirm") {
        if (key.escape) {
          setStage("edit");
          setBuffer("");
        } else if (key.return) {
          if (buffer.toUpperCase() === sym) doPlace();
        } else if (key.backspace || key.delete) {
          setBuffer((b) => b.slice(0, -1));
        } else if (/^[A-Za-z.]$/.test(input)) {
          setBuffer((b) => (b + input).toUpperCase().slice(0, 8));
        }
        return;
      }

      // stage === "edit"
      if (key.escape) {
        onClose();
        return;
      }
      if (key.return) {
        if (canReview) setStage("confirm");
        return;
      }
      if (key.upArrow) {
        setFocus((f) => Math.max(0, f - 1));
        return;
      }
      if (key.downArrow) {
        setFocus((f) => Math.min(fields.length - 1, f + 1));
        return;
      }

      const field = fields[foc];
      if (!field) return;
      if (field.kind === "choice") {
        if (key.leftArrow || key.rightArrow || input === " ") field.toggle?.();
      } else if (key.backspace || key.delete) {
        field.backspace?.();
      } else if (input && field.accept?.(input)) {
        field.append?.(input);
      }
    },
    { isActive: process.stdin.isTTY === true },
  );

  const liveBanner =
    mode === "live" ? (
      <Text bold color={theme.negative}>
        🚨 LIVE — REAL MONEY
      </Text>
    ) : (
      <Text bold color={theme.warning}>
        📝 PAPER — fake money
      </Text>
    );

  const orderLine = `${side.toUpperCase()} ${qty || "—"} ${sym || "—"} (${otype}${
    otype === "limit" && limitPrice ? ` @ $${limitPrice}` : ""
  })`;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={mode === "live" ? theme.negative : theme.warning}
      paddingX={1}
    >
      <Box justifyContent="space-between">
        <Text bold>Order ticket</Text>
        {liveBanner}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {fields.map((f, i) => {
          const sel = stage === "edit" && i === foc;
          return (
            <Box key={f.label}>
              <Text color={sel ? theme.accent : undefined} bold={sel}>
                {sel ? "› " : "  "}
                {f.label.padEnd(13)}
              </Text>
              <Text color={f.kind === "choice" ? theme.info : undefined}>{f.display}</Text>
              {sel && f.hint ? <Text {...mutedProps(theme)}>{"  " + f.hint}</Text> : null}
            </Box>
          );
        })}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text {...mutedProps(theme)}>{"— preview"}</Text>
        <Text>{orderLine}</Text>
        <Text {...mutedProps(theme)}>
          {"  "}last {price > 0 ? usd(price) : fetchingPrice ? "fetching…" : "unknown"} · est{" "}
          {side === "buy" ? "cost" : "proceeds"} {price > 0 ? usd(assessment.estCost) : "—"} · cash{" "}
          {usd(funds.cash)}
          {funds.margin > 0 ? ` (+${usd(funds.margin)} margin)` : ""}
          {heldQty > 0 ? ` · you hold ${heldQty}` : ""}
        </Text>
        {assessment.warnings.map((w, i) => (
          <Text key={i} color={theme.warning}>
            {"  ⚠ "}
            {w}
          </Text>
        ))}
        {fetchingPrice ? (
          <Text color={theme.warning}>
            {"  … fetching price for "}
            {sym}
          </Text>
        ) : null}
        {assessment.blocks
          // While a price lookup is in flight, "price unavailable" is a
          // transient state, not a verdict — showing it would flash a scary
          // block on every keystroke.
          .filter((b) => !(fetchingPrice && b.includes("price unavailable")))
          .map((b, i) => (
            <Text key={i} color={theme.negative}>
              {"  ✗ "}
              {b}
            </Text>
          ))}
      </Box>

      <Box marginTop={1} flexDirection="column">
        {stage === "edit" ? (
          canReview ? (
            <Text {...mutedProps(theme)}>
              ↑↓ field · ←/→ toggle · type to edit · ⏎ review · esc cancel
            </Text>
          ) : (
            <Text color={theme.negative}>fix the ✗ blocks above to continue</Text>
          )
        ) : null}

        {stage === "confirm" ? (
          <>
            {liveBanner}
            <Text>
              Type <Text bold>{sym}</Text> to place this order:{" "}
              <Text color={theme.info}>{buffer || " "}</Text>
            </Text>
            <Text {...mutedProps(theme)}>
              {buffer.toUpperCase() === sym ? "⏎ PLACE ORDER" : "…"} · esc back
            </Text>
          </>
        ) : null}

        {stage === "placing" ? <Text color={theme.warning}>placing order…</Text> : null}

        {stage === "done" && result ? (
          <>
            {result.ok ? (
              <Text color={theme.positive}>
                ✅ order accepted — {result.status} · id {result.id?.slice(0, 8)}
              </Text>
            ) : (
              <Text color={theme.negative}>❌ order failed: {result.message}</Text>
            )}
            <Text {...mutedProps(theme)}>logged to journal/orders.log · esc close</Text>
            {journal?.ok ? (
              <Text {...mutedProps(theme)}>
                reasoning journaled to journal/{basename(journal.file)}
              </Text>
            ) : journal ? (
              <Text color={theme.warning}>⚠ could not write the journal: {journal.error}</Text>
            ) : null}
          </>
        ) : null}
      </Box>
    </Box>
  );
}
