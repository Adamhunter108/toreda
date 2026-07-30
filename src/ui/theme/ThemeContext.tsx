// The dashboard's active colour theme, in React context so any component can
// read palette roles without prop-drilling. Selection persists to config/ui.json
// and re-renders the whole tree live, which is what makes the theme picker an
// instant preview rather than a restart-to-see-it setting.
import * as React from "react";
import { createContext, useCallback, useContext, useState } from "react";
import { DEFAULT_THEME, THEME_ORDER, THEMES, type Theme } from "../../core/theme";
import { loadUiConfig, saveUiConfig } from "../../core/ui-config";

interface ThemeContextValue {
  theme: Theme;
  themeName: string;
  setTheme: (name: string) => void;
  /** Display order for the picker. */
  themes: readonly string[];
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // DASH_THEME seeds a theme for non-interactive smoke tests, where no keypress
  // can select one.
  const [themeName, setThemeName] = useState<string>(
    () => process.env.DASH_THEME ?? loadUiConfig().theme,
  );

  const setTheme = useCallback((name: string) => {
    if (!(name in THEMES)) return;
    setThemeName(name);
    saveUiConfig({ theme: name });
  }, []);

  const theme = THEMES[themeName] ?? THEMES[DEFAULT_THEME]!;
  const value: ThemeContextValue = { theme, themeName, setTheme, themes: THEME_ORDER };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

function useThemeContext(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}

/** The active palette — the common case for rendering. */
export function useTheme(): Theme {
  return useThemeContext().theme;
}

/** Name, setter and list — for the theme picker. */
export function useThemeControls(): Omit<ThemeContextValue, "theme"> {
  const { themeName, setTheme, themes } = useThemeContext();
  return { themeName, setTheme, themes };
}
