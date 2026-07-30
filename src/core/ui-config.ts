// config/ui.json — dashboard preferences. Currently just the active theme.

import { loadJsonConfig, saveJsonConfig } from "./json-config";
import { DEFAULT_THEME, THEMES } from "./theme";

export interface UiConfig {
  theme: string;
}

export const DEFAULT_UI_CONFIG: UiConfig = { theme: DEFAULT_THEME };

export function loadUiConfig(): UiConfig {
  return loadJsonConfig<UiConfig>("ui.json", DEFAULT_UI_CONFIG, (raw, defaults) => {
    // Validate against what actually exists. A stale or hand-typed theme name
    // falls back to Default rather than rendering the dashboard colourless.
    const theme = typeof raw.theme === "string" && raw.theme in THEMES ? raw.theme : defaults.theme;
    return { theme };
  }).value;
}

export function saveUiConfig(config: UiConfig): void {
  saveJsonConfig("ui.json", config);
}
