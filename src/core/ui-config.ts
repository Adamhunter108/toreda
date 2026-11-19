// config/ui.json — dashboard preferences: the theme, and how the watchlist
// panel is sorted.

import { loadJsonConfig, saveJsonConfig } from "./json-config";
import { DEFAULT_THEME, THEMES } from "./theme";

/**
 * Watchlist panel orders, cycled with `s` while the panel is focused: the
 * biggest move today either way, your own order (rearranged with `w`), A–Z.
 */
export const WATCHLIST_SORTS = ["move", "custom", "symbol"] as const;
export type WatchlistSort = (typeof WATCHLIST_SORTS)[number];

export interface UiConfig {
  theme: string;
  watchlistSort: WatchlistSort;
}

export const DEFAULT_UI_CONFIG: UiConfig = { theme: DEFAULT_THEME, watchlistSort: "move" };

function isWatchlistSort(v: unknown): v is WatchlistSort {
  return typeof v === "string" && (WATCHLIST_SORTS as readonly string[]).includes(v);
}

export function loadUiConfig(): UiConfig {
  return loadJsonConfig<UiConfig>("ui.json", DEFAULT_UI_CONFIG, (raw, defaults) => {
    // Validate against what actually exists. A stale or hand-typed theme name
    // falls back to Default rather than rendering the dashboard colourless.
    const theme = typeof raw.theme === "string" && raw.theme in THEMES ? raw.theme : defaults.theme;
    const watchlistSort = isWatchlistSort(raw.watchlistSort)
      ? raw.watchlistSort
      : defaults.watchlistSort;
    return { theme, watchlistSort };
  }).value;
}

/**
 * Change some preferences, keeping the rest as they are on disk. Each setter
 * passes only its own field: picking a theme must not reset the watchlist sort.
 */
export function saveUiConfig(changes: Partial<UiConfig>): void {
  saveJsonConfig("ui.json", { ...loadUiConfig(), ...changes });
}
