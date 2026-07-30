import * as React from "react";
import { useState } from "react";
import { Box, Text, useInput } from "ink";
import { getAsset } from "../../core/alpaca";
import { mutedProps } from "../../core/theme";
import { addWatchlistSymbol, removeWatchlistSymbol } from "../../core/watchlist";
import { useTheme } from "../theme/ThemeContext";

const VISIBLE = 14;

/**
 * Full-screen watchlist editor, opened with `w`.
 *
 * `a` adds — validating the ticker against Alpaca BEFORE writing, because a
 * typo'd symbol in a watchlist is silent: it simply never produces a signal, and
 * you conclude the market was quiet.
 */
export function WatchlistManager({
  symbols,
  onChange,
  onClose,
}: {
  symbols: string[];
  onChange: () => void;
  onClose: () => void;
}) {
  const t = useTheme();
  const [cursor, setCursor] = useState(0);
  const [addMode, setAddMode] = useState(false);
  const [buffer, setBuffer] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const n = symbols.length;
  const cur = Math.min(cursor, Math.max(0, n - 1));

  async function submitAdd(): Promise<void> {
    const s = buffer.trim().toUpperCase();
    setAddMode(false);
    setBuffer("");
    if (!s) return;

    setMsg(`validating ${s}…`);
    const asset = await getAsset(s).catch(() => null);
    if (!asset || !asset.tradable) {
      setMsg(`${s} — not a valid tradable symbol`);
      return;
    }
    const added = addWatchlistSymbol(s);
    setMsg(added ? `added ${s} — ${asset.name}` : `${s} is already on the watchlist`);
    if (added) onChange();
  }

  function removeCurrent(): void {
    const s = symbols[cur];
    if (!s) return;
    removeWatchlistSymbol(s);
    setMsg(`removed ${s}`);
    setCursor((c) => Math.max(0, Math.min(c, n - 2)));
    onChange();
  }

  useInput(
    (input, key) => {
      if (addMode) {
        if (key.escape) {
          setAddMode(false);
          setBuffer("");
        } else if (key.return) {
          void submitAdd();
        } else if (key.backspace || key.delete) {
          setBuffer((b) => b.slice(0, -1));
        } else if (/^[A-Za-z.]$/.test(input)) {
          setBuffer((b) => (b + input).toUpperCase().slice(0, 6));
        }
        return;
      }
      if (key.escape) onClose();
      else if (key.upArrow) setCursor((c) => Math.max(0, c - 1));
      else if (key.downArrow) setCursor((c) => Math.min(n - 1, c + 1));
      else if (input === "a") {
        setAddMode(true);
        setBuffer("");
        setMsg(null);
      } else if ((input === "d" || input === "x") && n > 0) removeCurrent();
    },
    { isActive: process.stdin.isTTY === true },
  );

  const start = Math.max(0, Math.min(cur - Math.floor(VISIBLE / 2), Math.max(0, n - VISIBLE)));
  const view = symbols.slice(start, start + VISIBLE);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={t.border} paddingX={1}>
      <Text bold>
        Manage watchlist <Text {...mutedProps(t)}>({n} symbols)</Text>
      </Text>
      {start > 0 ? <Text {...mutedProps(t)}> ↑ more…</Text> : null}
      {view.map((s, i) => {
        const isSel = start + i === cur;
        return (
          <Text key={s} color={isSel ? t.accent : undefined} bold={isSel}>
            {isSel ? "› " : "  "}
            {s}
          </Text>
        );
      })}
      {start + VISIBLE < n ? <Text {...mutedProps(t)}> ↓ more…</Text> : null}

      <Box marginTop={1} flexDirection="column">
        {addMode ? (
          <Text>
            Add symbol: <Text color={t.info}>{buffer || " "}</Text>
            <Text {...mutedProps(t)}>▏ (Enter to add · Esc cancel)</Text>
          </Text>
        ) : (
          <Text {...mutedProps(t)}>a add · d remove · ↑↓ move · esc back</Text>
        )}
        {msg ? (
          <Text color={/not a valid/.test(msg) ? t.negative : t.positive}>{msg}</Text>
        ) : null}
      </Box>
      <Text {...mutedProps(t)}>
        Positions you hold are always scanned, listed here or not.
      </Text>
    </Box>
  );
}
