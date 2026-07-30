import * as React from "react";
import { useState } from "react";
import { Box, Text, useInput } from "ink";
import { mutedProps, THEMES } from "../../core/theme";
import { useTheme, useThemeControls } from "../theme/ThemeContext";

/**
 * Full-screen theme picker, opened with `t`.
 *
 * ↑↓ highlights a theme and applies it LIVE — the choice persists on every move,
 * so `esc` just closes. Each row previews the theme in its own colours, because
 * choosing a palette from four names is guesswork and choosing it from four
 * palettes is just looking.
 */
const SWATCH = "███";

const ROLES = ["positive", "negative", "warning", "accent", "info", "muted"] as const;

export function ThemePicker({ onClose }: { onClose: () => void }) {
  const t = useTheme();
  const { themeName, setTheme, themes } = useThemeControls();
  const [cursor, setCursor] = useState(() => Math.max(0, themes.indexOf(themeName)));

  // Called from the input handler rather than during render, so updating both
  // this cursor and the provider's theme is safe here.
  const move = (dir: number): void => {
    const next = Math.max(0, Math.min(themes.length - 1, cursor + dir));
    if (next === cursor) return;
    setCursor(next);
    const name = themes[next];
    if (name) setTheme(name); // live-apply and persist on highlight
  };

  useInput(
    (input, key) => {
      if (key.escape || key.return || input === "q" || input === "t") onClose();
      else if (key.downArrow || input === "j") move(1);
      else if (key.upArrow || input === "k") move(-1);
    },
    { isActive: process.stdin.isTTY === true },
  );

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={t.border} paddingX={1}>
      <Text bold>
        Colour theme <Text {...mutedProps(t)}>· config/ui.json · live preview</Text>
      </Text>
      <Text> </Text>
      {themes.map((name, i) => {
        const theme = THEMES[name];
        if (!theme) return null;
        const sel = i === cursor;
        const active = name === themeName;
        return (
          <Box key={name}>
            <Text color={sel ? t.accent : undefined} bold={sel}>
              {sel ? "› " : "  "}
              {name.padEnd(10)}
            </Text>
            {ROLES.map((role) => (
              <Text key={role} color={theme[role]}>
                {SWATCH}
              </Text>
            ))}
            <Text color={active ? t.positive : t.muted}>{active ? "  ● active" : ""}</Text>
          </Box>
        );
      })}
      <Text> </Text>
      <Text {...mutedProps(t)}>
        swatches: gain · loss · warn · accent · info · muted{"\n"}
        ↑↓ preview (applies instantly) · esc done
      </Text>
    </Box>
  );
}
