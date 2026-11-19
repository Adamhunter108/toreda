import * as React from "react";
import { useState } from "react";
import { Box, Text, useInput } from "ink";
import { getAsset } from "../../core/alpaca";
import { mutedProps } from "../../core/theme";
import {
  addWatchlistSymbol,
  moveWatchlistSymbol,
  removeWatchlistSymbol,
} from "../../core/watchlist";
import { useTheme } from "../theme/ThemeContext";

const VISIBLE = 14;

/**
 * Full-screen watchlist editor, opened with `w`.
 *
 * `a` adds — validating the ticker against Alpaca BEFORE writing, because a
 * typo'd symbol in a watchlist is silent: it simply never produces a signal, and
 * you conclude the market was quiet.
 *
 * Reordering: Enter picks up the highlighted symbol, ↑↓ carry it, Enter puts it
 * down and Esc puts it back where it was. K/J move it one place without picking
 * it up. That order is what the watchlist panel shows when sorted by "your
 * order", so the names you watch most can sit at the top of a panel too short
 * to show them all.
 *
 * Not shift+↑↓: macOS Terminal sends a plain arrow for it by default, so it
 * moved the cursor instead and looked broken. Plain keys work everywhere.
 */
export function WatchlistManager({
  symbols,
  onChange,
  onClose,
}: {
  /** In display order (`Watchlist.ordered`), so moves show where they land. */
  symbols: string[];
  onChange: () => void;
  onClose: () => void;
}) {
  const t = useTheme();
  const [cursor, setCursor] = useState(0);
  const [addMode, setAddMode] = useState(false);
  const [buffer, setBuffer] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  // The symbol picked up with Enter, and where it started (for Esc).
  const [held, setHeld] = useState<{ symbol: string; from: number } | null>(null);

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

  /** Move `s` by `by` places, saving at once, with the cursor following it. */
  function move(s: string | undefined, by: number): void {
    const at = s ? symbols.indexOf(s) : -1;
    if (!s || at === -1 || !moveWatchlistSymbol(s, by)) return;
    setCursor(Math.max(0, Math.min(n - 1, at + by)));
    setMsg(null);
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
      if (held) {
        // Every step is saved as it happens, so Esc undoes by moving back.
        if (key.upArrow) move(held.symbol, -1);
        else if (key.downArrow) move(held.symbol, 1);
        else if (key.return) {
          setHeld(null);
          setMsg(`moved ${held.symbol}`);
        } else if (key.escape) {
          move(held.symbol, held.from - symbols.indexOf(held.symbol));
          setHeld(null);
        }
        return;
      }
      if (key.escape) onClose();
      else if (key.return && symbols[cur]) {
        setHeld({ symbol: symbols[cur]!, from: cur });
        setMsg(null);
      } else if (input === "K") move(symbols[cur], -1);
      else if (input === "J") move(symbols[cur], 1);
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
        Manage watchlist <Text {...mutedProps(t)}>({n} symbols, in your order)</Text>
      </Text>
      {start > 0 ? <Text {...mutedProps(t)}> ↑ more…</Text> : null}
      {view.map((s, i) => {
        const isSel = start + i === cur;
        const isHeld = held?.symbol === s;
        return (
          <Text key={s} color={isHeld ? t.info : isSel ? t.accent : undefined} bold={isSel}>
            {isHeld ? "↕ " : isSel ? "› " : "  "}
            {s}
            {isHeld ? <Text {...mutedProps(t)}>{"  moving"}</Text> : null}
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
        ) : held ? (
          <Text {...mutedProps(t)}>
            moving {held.symbol} · ↑↓ move · ⏎ put down · esc put back
          </Text>
        ) : (
          <Text {...mutedProps(t)}>
            a add · d remove · ↑↓ select · ⏎ pick up to reorder (or K/J) · esc back
          </Text>
        )}
        {msg ? (
          <Text color={/not a valid/.test(msg) ? t.negative : t.positive}>{msg}</Text>
        ) : null}
      </Box>
      <Text {...mutedProps(t)}>
        The panel shows this order when sorted by "your order" (s, with the watchlist focused).
      </Text>
      <Text {...mutedProps(t)}>
        Positions you hold are always scanned, listed here or not.
      </Text>
    </Box>
  );
}
