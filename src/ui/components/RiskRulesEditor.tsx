import * as React from "react";
import { useState } from "react";
import { Box, Text, useInput } from "ink";
import { localDate } from "../../core/journal";
import { describeRuleChanges, lapsedReason, type RiskRules, stopFor } from "../../core/risk";
import { mutedProps } from "../../core/theme";
import { easternDate } from "../../core/transfers";
import { reviewPositions } from "../../scanner/review";
import type { AccountState, PositionAlert } from "../../scanner/types";
import { useTheme } from "../theme/ThemeContext";

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
const round2 = (n: number): number => Math.round(n * 100) / 100;
const pct = (fraction: number): string => `${Math.round(fraction * 100)}%`;
const PRINTABLE = /^[^\x00-\x1f\x7f]+$/;

const DAY_MS = 86_400_000;
/** Where a new end date starts: a week out. */
const DEFAULT_DAYS = 7;
const MAX_DAYS = 365;
const utcDay = (date: string): number => {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y!, m! - 1, d!);
};
/** The YYYY-MM-DD date `n` days after `date`. */
const addDays = (date: string, n: number): string =>
  new Date(utcDay(date) + n * DAY_MS).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string): number =>
  Math.round((utcDay(to) - utcDay(from)) / DAY_MS);
/** "Fri, Nov 21". */
const dayLabel = (date: string): string =>
  new Date(utcDay(date)).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Which kind of per-symbol exception a row or flow is about. */
type Target = "ceiling" | "stop";

type Stage =
  | { kind: "browse" }
  | { kind: "discard" }
  | { kind: "symbol"; target: Target; buffer: string }
  | { kind: "ceiling"; symbol: string; value: number }
  /** `days` is the end date, as days from today; 0 is none (tighter stops only). */
  | { kind: "stop"; symbol: string; value: number; days: number }
  | { kind: "until"; symbol: string; value: number; days: number }
  | { kind: "reason"; target: Target; symbol: string; value: number; days: number; buffer: string }
  | { kind: "review"; buffer: string }
  | { kind: "saved"; ok: boolean; message: string };

type Row =
  | { kind: "header"; label: string }
  | { kind: "note"; label: string }
  | { kind: "number"; label: string; value: string; was: string | null; adjust: (dir: number) => void }
  | { kind: "override"; target: Target; symbol: string }
  | { kind: "add"; target: Target };

export interface SaveResult {
  ok: boolean;
  message: string;
}

/**
 * Edit config/risk.json in the TUI, opened with `l`.
 *
 * Unlike scanner settings, nothing saves until you say so: these are the rules
 * that decide when you are told to sell, and a stray arrow key should not be
 * able to loosen a stop. Edits are a draft; `s` shows exactly what changes —
 * including any live breach the change would make disappear — and saving writes
 * the file and journals the change.
 *
 * An override needs a reason before it can be added, and is dated
 * automatically. That is the repo's own convention (see core/risk.ts): an
 * override without a recorded rationale is indistinguishable from drift when
 * you review it six months later.
 *
 * A stop exception also needs an end date whenever it loosens the stop: the
 * flow will not offer "no end date" for one. See `StopOverride` for why.
 */
export function RiskRulesEditor({
  rules: initialRules,
  book,
  onSave,
  onClose,
}: {
  /** The saved rules, as of opening the editor. */
  rules: RiskRules;
  /** The live book, to preview what a change does to current breaches. */
  book: AccountState | null;
  /** `baseline` is what the edit started from, so a concurrent change is caught. */
  onSave: (next: RiskRules, why: string, baseline: RiskRules) => SaveResult;
  onClose: () => void;
}) {
  const t = useTheme();
  // Everything is diffed against the rules as they were when editing began,
  // even if the file changes underneath — the save then refuses rather than
  // overwriting someone else's edit.
  const [rules] = useState<RiskRules>(() => structuredClone(initialRules));
  const [draft, setDraft] = useState<RiskRules>(() => structuredClone(initialRules));
  const [stage, setStage] = useState<Stage>({ kind: "browse" });
  const [cursor, setCursor] = useState(1);

  const changes = describeRuleChanges(rules, draft);
  const dirty = changes.length > 0;
  const update = (mutate: (r: RiskRules) => RiskRules): void =>
    setDraft((d) => mutate(structuredClone(d)));

  const today = easternDate(new Date());
  const looser = (value: number): boolean => value < draft.stopLossPct;
  const overrideSymbols = Object.keys(draft.overrides).sort();
  const stopSymbols = Object.keys(draft.stopOverrides).sort();
  const rows: Row[] = [
    { kind: "header", label: "Exits" },
    {
      kind: "number",
      label: "Stop loss (from entry)",
      value: `${draft.stopLossPct}%`,
      was: draft.stopLossPct !== rules.stopLossPct ? `${rules.stopLossPct}%` : null,
      adjust: (dir) =>
        update((r) => ({ ...r, stopLossPct: clamp(r.stopLossPct + dir, -50, -1) })),
    },
    {
      kind: "number",
      label: "Trim trigger (gain)",
      value: `+${draft.trimProfitPct}%`,
      was: draft.trimProfitPct !== rules.trimProfitPct ? `+${rules.trimProfitPct}%` : null,
      adjust: (dir) =>
        update((r) => ({ ...r, trimProfitPct: clamp(r.trimProfitPct + dir * 5, 5, 500) })),
    },
    { kind: "header", label: "Stop exceptions — dated; a looser stop needs an end date" },
    ...(stopSymbols.length === 0
      ? [{ kind: "note", label: "none — every position uses the default stop" } as Row]
      : stopSymbols.map((symbol): Row => ({ kind: "override", target: "stop", symbol }))),
    { kind: "add", target: "stop" },
    { kind: "header", label: "Position size" },
    {
      kind: "number",
      label: "Default ceiling",
      value: pct(draft.defaultMaxWeight),
      was: draft.defaultMaxWeight !== rules.defaultMaxWeight ? pct(rules.defaultMaxWeight) : null,
      adjust: (dir) =>
        update((r) => ({
          ...r,
          defaultMaxWeight: clamp(round2(r.defaultMaxWeight + dir * 0.01), 0.01, 1),
        })),
    },
    { kind: "header", label: "Overrides — dated exceptions to the ceiling" },
    ...(overrideSymbols.length === 0
      ? [{ kind: "note", label: "none — every symbol uses the default ceiling" } as Row]
      : overrideSymbols.map((symbol): Row => ({ kind: "override", target: "ceiling", symbol }))),
    { kind: "add", target: "ceiling" },
  ];

  const selectable = (i: number): boolean =>
    rows[i] !== undefined && rows[i]!.kind !== "header" && rows[i]!.kind !== "note";
  const step = (from: number, dir: number): number => {
    let i = from + dir;
    while (i >= 0 && i < rows.length && !selectable(i)) i += dir;
    return selectable(i) ? i : from;
  };
  // Rows shift when an override is added or removed; keep the cursor valid.
  const cur = selectable(cursor) ? cursor : step(Math.min(cursor, rows.length - 1), -1);
  const row = rows[cur];

  // What these rules would say about the book right now, against the saved ones.
  const key = (a: PositionAlert): string => `${a.symbol} ${a.rule}`;
  const before = book ? reviewPositions(book, rules) : [];
  const after = book ? reviewPositions(book, draft) : [];
  const cleared = before.filter((a) => !after.some((b) => key(b) === key(a)));
  const created = after.filter((a) => !before.some((b) => key(b) === key(a)));

  /** Where editing a symbol's exception starts: its current values, or the defaults. */
  const editStage = (target: Target, symbol: string): Stage => {
    if (target === "ceiling") {
      return {
        kind: "ceiling",
        symbol,
        value: draft.overrides[symbol]?.maxWeight ?? draft.defaultMaxWeight,
      };
    }
    const o = draft.stopOverrides[symbol];
    // An end date already past counts as none; a looser stop then gets a fresh one.
    const days = o && ISO_DATE.test(o.until) ? clamp(daysBetween(today, o.until), 0, MAX_DAYS) : 0;
    return { kind: "stop", symbol, value: o?.stopLossPct ?? draft.stopLossPct, days };
  };

  useInput(
    (input, k) => {
      const typed = input && PRINTABLE.test(input) && !k.ctrl && !k.meta ? input : "";
      const erase = k.backspace || k.delete;

      switch (stage.kind) {
        case "browse": {
          if (k.escape || input === "q") {
            if (dirty) setStage({ kind: "discard" });
            else onClose();
          } else if (k.downArrow) setCursor(step(cur, 1));
          else if (k.upArrow) setCursor(step(cur, -1));
          else if (k.leftArrow && row?.kind === "number") row.adjust(-1);
          else if (k.rightArrow && row?.kind === "number") row.adjust(1);
          else if (k.return && row?.kind === "add") {
            setStage({ kind: "symbol", target: row.target, buffer: "" });
          } else if (k.return && row?.kind === "override") {
            setStage(editStage(row.target, row.symbol));
          } else if ((input === "x" || erase) && row?.kind === "override") {
            update((r) => {
              if (row.target === "stop") delete r.stopOverrides[row.symbol];
              else delete r.overrides[row.symbol];
              return r;
            });
          } else if (input === "s" && dirty) setStage({ kind: "review", buffer: "" });
          return;
        }
        case "discard": {
          if (k.escape) onClose();
          else if (input === "s") setStage({ kind: "review", buffer: "" });
          else setStage({ kind: "browse" });
          return;
        }
        case "symbol": {
          if (k.escape) setStage({ kind: "browse" });
          else if (k.return) {
            const symbol = stage.buffer.trim().toUpperCase();
            if (!symbol) return;
            setStage(editStage(stage.target, symbol));
          } else if (erase) setStage({ ...stage, buffer: stage.buffer.slice(0, -1) });
          else if (/^[A-Za-z0-9.]+$/.test(typed)) {
            setStage({ ...stage, buffer: (stage.buffer + typed).toUpperCase().slice(0, 8) });
          }
          return;
        }
        case "ceiling": {
          if (k.escape) setStage({ kind: "browse" });
          else if (k.leftArrow) setStage({ ...stage, value: clamp(round2(stage.value - 0.01), 0.01, 1) });
          else if (k.rightArrow) setStage({ ...stage, value: clamp(round2(stage.value + 0.01), 0.01, 1) });
          else if (k.return) {
            setStage({
              kind: "reason",
              target: "ceiling",
              symbol: stage.symbol,
              value: stage.value,
              days: 0,
              buffer: "",
            });
          }
          return;
        }
        case "stop": {
          if (k.escape) setStage({ kind: "browse" });
          // ← loosens (further from entry), → tightens, as on the default stop.
          else if (k.leftArrow) setStage({ ...stage, value: clamp(stage.value - 1, -50, -1) });
          else if (k.rightArrow) setStage({ ...stage, value: clamp(stage.value + 1, -50, -1) });
          else if (k.return) {
            // A looser stop cannot be open-ended; start it a week out.
            const days = looser(stage.value) && stage.days < 1 ? DEFAULT_DAYS : stage.days;
            setStage({ kind: "until", symbol: stage.symbol, value: stage.value, days });
          }
          return;
        }
        case "until": {
          const min = looser(stage.value) ? 1 : 0;
          if (k.escape) setStage({ kind: "browse" });
          else if (k.leftArrow) setStage({ ...stage, days: clamp(stage.days - 1, min, MAX_DAYS) });
          else if (k.rightArrow) setStage({ ...stage, days: clamp(stage.days + 1, min, MAX_DAYS) });
          else if (k.return) setStage({ ...stage, kind: "reason", target: "stop", buffer: "" });
          return;
        }
        case "reason": {
          if (k.escape) setStage({ kind: "browse" });
          else if (k.return) {
            const reason = stage.buffer.trim();
            if (!reason) return; // required — the whole point of an override
            const decided = localDate(new Date());
            update((r) => {
              if (stage.target === "stop") {
                r.stopOverrides[stage.symbol] = {
                  stopLossPct: stage.value,
                  decided,
                  until: stage.days > 0 ? addDays(today, stage.days) : "",
                  reason,
                };
              } else {
                r.overrides[stage.symbol] = { maxWeight: stage.value, decided, reason };
              }
              return r;
            });
            setStage({ kind: "browse" });
          } else if (erase) setStage({ ...stage, buffer: stage.buffer.slice(0, -1) });
          else if (typed) setStage({ ...stage, buffer: (stage.buffer + typed).slice(0, 200) });
          return;
        }
        case "review": {
          if (k.escape) setStage({ kind: "browse" });
          else if (k.return) {
            const result = onSave(draft, stage.buffer, rules);
            setStage({ kind: "saved", ok: result.ok, message: result.message });
          } else if (erase) setStage({ ...stage, buffer: stage.buffer.slice(0, -1) });
          else if (typed) setStage({ ...stage, buffer: (stage.buffer + typed).slice(0, 300) });
          return;
        }
        case "saved": {
          if (k.escape || k.return) onClose();
          return;
        }
      }
    },
    { isActive: process.stdin.isTTY === true },
  );

  const currentWeight = (symbol: string): string => {
    const w = book?.positions[symbol]?.weight;
    return w === undefined ? "not held" : `now ${(w * 100).toFixed(1)}%`;
  };
  const currentPl = (symbol: string): string => {
    const p = book?.positions[symbol]?.unrealizedPlPct;
    return p === undefined ? "not held" : `now ${(p * 100).toFixed(1)}% from entry`;
  };
  /** "until Fri, Nov 21 (7 days)", or "no end date". */
  const endLabel = (days: number): string =>
    days > 0
      ? `until ${dayLabel(addDays(today, days))} (${days} day${days === 1 ? "" : "s"})`
      : "no end date";

  const effects = (
    <Box flexDirection="column" marginTop={1}>
      {!book ? (
        <Text {...mutedProps(t)}>Effect on your book: unknown until the account loads.</Text>
      ) : (
        <>
          <Text {...mutedProps(t)}>
            Under {dirty ? "these" : "your"} rules your book has{" "}
            {after.length === 0 ? "no breaches" : `${after.length} breach${after.length === 1 ? "" : "es"}`}
            {dirty ? ` (saved rules: ${before.length})` : ""}.
          </Text>
          {cleared.map((a) => (
            <Text key={"c" + key(a)} color={t.warning}>
              {"  "}clears a live breach: {a.symbol} {a.rule.toLowerCase()}
            </Text>
          ))}
          {created.map((a) => (
            <Text key={"n" + key(a)} color={t.negative}>
              {"  "}new breach: {a.symbol} {a.rule.toLowerCase()} → {a.action.toLowerCase()}
            </Text>
          ))}
        </>
      )}
    </Box>
  );

  // ── Review / saved ────────────────────────────────────────────────────────

  if (stage.kind === "review" || stage.kind === "saved") {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={t.accent} paddingX={1}>
        <Text bold>
          Save risk rules <Text {...mutedProps(t)}>· config/risk.json</Text>
        </Text>
        <Box flexDirection="column" marginTop={1}>
          {changes.map((c) => (
            <Text key={c}>
              {"  • "}
              {c}
            </Text>
          ))}
        </Box>
        {effects}
        {cleared.length > 0 ? (
          <Text color={t.warning}>
            {"  "}A rule that clears a live breach is a decision, not a fix for the alert.
          </Text>
        ) : null}
        {stage.kind === "review" ? (
          <Box flexDirection="column" marginTop={1}>
            <Text>
              Why? <Text {...mutedProps(t)}>(optional — goes in your journal)</Text>
            </Text>
            <Text color={t.info}>
              {"  "}
              {stage.buffer}▏
            </Text>
            <Text {...mutedProps(t)}>{"\n"}⏎ save and journal · esc back to editing</Text>
          </Box>
        ) : (
          <Box flexDirection="column" marginTop={1}>
            <Text color={stage.ok ? t.positive : t.negative}>
              {stage.ok ? "✓ " : "✗ "}
              {stage.message}
            </Text>
            <Text {...mutedProps(t)}>{"\n"}esc back to the dashboard</Text>
          </Box>
        )}
      </Box>
    );
  }

  // ── Browse, and the inline override flow ──────────────────────────────────

  const flow =
    stage.kind === "symbol" ? (
      <Text>
        {stage.target === "stop" ? "Stop exception" : "Override"} for which symbol?{" "}
        <Text color={t.info}>{stage.buffer}▏</Text>
        <Text {...mutedProps(t)}> ⏎ next · esc cancel</Text>
      </Text>
    ) : stage.kind === "stop" ? (
      <Box flexDirection="column">
        <Text>
          {stage.symbol} stop: <Text color={t.info}>{stage.value}%</Text>
          <Text {...mutedProps(t)}>
            {"  "}default {draft.stopLossPct}% · {currentPl(stage.symbol)} · ←/→ adjust · ⏎ next · esc
            cancel
          </Text>
        </Text>
        <Text {...mutedProps(t)}>
          {looser(stage.value)
            ? "  looser than your default — it will need an end date"
            : "  at or tighter than your default — an end date is optional"}
        </Text>
      </Box>
    ) : stage.kind === "until" ? (
      <Box flexDirection="column">
        <Text>
          {stage.symbol} {stage.value}% <Text color={t.info}>{endLabel(stage.days)}</Text>
          <Text {...mutedProps(t)}>{"  "}←/→ adjust · ⏎ next · esc cancel</Text>
        </Text>
        <Text {...mutedProps(t)}>
          {looser(stage.value)
            ? `  After that day your ${draft.stopLossPct}% stop applies again, and so does its SELL alert.`
            : "  ← to 0 days for no end date."}
        </Text>
      </Box>
    ) : stage.kind === "ceiling" ? (
      <Text>
        {stage.symbol} ceiling: <Text color={t.info}>{pct(stage.value)}</Text>
        <Text {...mutedProps(t)}>
          {"  "}default {pct(draft.defaultMaxWeight)} · {currentWeight(stage.symbol)} · ←/→ adjust ·
          ⏎ next · esc cancel
        </Text>
      </Text>
    ) : stage.kind === "reason" ? (
      <Box flexDirection="column">
        <Text>
          {stage.target === "stop"
            ? `Why does ${stage.symbol} get a ${stage.value}% stop, ${endLabel(stage.days)}? `
            : `Why does ${stage.symbol} get ${pct(stage.value)}? `}
          <Text {...mutedProps(t)}>(required — dated {localDate(new Date())})</Text>
        </Text>
        <Text color={t.info}>
          {"  "}
          {stage.buffer}▏
        </Text>
        <Text {...mutedProps(t)}>
          {stage.buffer.trim()
            ? stage.target === "stop"
              ? "⏎ add stop exception"
              : "⏎ add override"
            : "a reason is required"}{" "}
          · esc cancel
        </Text>
      </Box>
    ) : null;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={t.border} paddingX={1}>
      <Text bold>
        Risk rules <Text {...mutedProps(t)}>· config/risk.json{dirty ? " · unsaved changes" : ""}</Text>
      </Text>

      {rows.map((r, i) => {
        if (r.kind === "header") {
          return (
            <Text key={"h" + r.label} bold {...mutedProps(t)}>
              {"\n"}
              {r.label}
            </Text>
          );
        }
        if (r.kind === "note") {
          return (
            <Text key={"n" + r.label} {...mutedProps(t)}>
              {"  "}
              {r.label}
            </Text>
          );
        }
        const sel = i === cur && stage.kind === "browse";
        const lead = (
          <Text color={sel ? t.accent : undefined} bold={sel}>
            {sel ? "› " : "  "}
          </Text>
        );
        if (r.kind === "number") {
          return (
            <Box key={r.label}>
              {lead}
              <Text color={sel ? t.accent : undefined} bold={sel}>
                {r.label.padEnd(26)}
              </Text>
              <Text color={t.info}>{r.value.padStart(5)}</Text>
              {r.was ? <Text color={t.warning}>{`  (was ${r.was})`}</Text> : null}
            </Box>
          );
        }
        if (r.kind === "override" && r.target === "stop") {
          const o = draft.stopOverrides[r.symbol]!;
          const saved = rules.stopOverrides[r.symbol];
          const mark = !saved
            ? "  (new)"
            : saved.stopLossPct !== o.stopLossPct || saved.until !== o.until || saved.reason !== o.reason
              ? "  (changed)"
              : "";
          // Checked against the draft, so a default stop changed in this edit counts.
          const { lapsed } = stopFor(r.symbol, draft, today);
          const ends = ISO_DATE.test(o.until) ? `until ${dayLabel(o.until)}` : "no end date";
          // Only the description shrinks; the cursor, symbol and figures keep their width.
          return (
            <Box key={"s" + r.symbol}>
              <Box flexShrink={0}>
                {lead}
                <Text color={sel ? t.accent : undefined} bold={sel}>
                  {r.symbol.padEnd(8)}
                </Text>
                <Text color={t.info}>{`${o.stopLossPct}%`.padStart(5)}</Text>
                {lapsed ? <Text color={t.warning}>{`  ${lapsedReason(lapsed)}`}</Text> : null}
              </Box>
              <Text {...mutedProps(t)} wrap="truncate-end">
                {`  ${lapsed ? "" : `${ends} · `}${currentPl(r.symbol)} · ${o.decided || "undated"} · ` +
                  `${o.reason || "no reason recorded"}`}
              </Text>
              {mark ? (
                <Box flexShrink={0}>
                  <Text color={t.warning}>{mark}</Text>
                </Box>
              ) : null}
            </Box>
          );
        }
        if (r.kind === "override") {
          const o = draft.overrides[r.symbol]!;
          const saved = rules.overrides[r.symbol];
          const mark = !saved
            ? "  (new)"
            : saved.maxWeight !== o.maxWeight || saved.reason !== o.reason
              ? "  (changed)"
              : "";
          return (
            <Box key={"o" + r.symbol}>
              <Box flexShrink={0}>
                {lead}
                <Text color={sel ? t.accent : undefined} bold={sel}>
                  {r.symbol.padEnd(8)}
                </Text>
                <Text color={t.info}>{pct(o.maxWeight).padStart(5)}</Text>
              </Box>
              <Text {...mutedProps(t)} wrap="truncate-end">
                {`  ${currentWeight(r.symbol)} · ${o.decided || "undated"} · ${o.reason || "no reason recorded"}`}
              </Text>
              {mark ? (
                <Box flexShrink={0}>
                  <Text color={t.warning}>{mark}</Text>
                </Box>
              ) : null}
            </Box>
          );
        }
        return (
          <Box key={"add" + r.target}>
            {lead}
            <Text color={sel ? t.accent : t.info} bold={sel}>
              {r.target === "stop" ? "+ add a stop exception" : "+ add an override"}
            </Text>
          </Box>
        );
      })}

      {flow ? <Box marginTop={1}>{flow}</Box> : null}
      {effects}

      <Text {...mutedProps(t)}>
        {"\n"}
        {stage.kind === "discard" ? (
          <Text color={t.warning}>unsaved changes — esc again discards · s saves · any key keeps editing</Text>
        ) : (
          `↑↓ move · ←/→ adjust · ⏎ add/edit · x remove · ${dirty ? "s save · " : ""}esc back`
        )}
      </Text>
    </Box>
  );
}
