// `toreda dash` — the live terminal dashboard.
//
// Ink and its layout engine are ESM-only and heavy, so this module is imported
// lazily by the command registry. A `toreda quote NVDA` run never loads React.

import * as React from "react";
import { render } from "ink";
import { loadConfig } from "../../core/config";
import type { ParsedArgs } from "../args";
import { App } from "../../ui/App";
import { ThemeProvider } from "../../ui/theme/ThemeContext";

export async function run(_args: ParsedArgs): Promise<number> {
  // Fail here, with a readable message, rather than inside a React render where
  // the error would be swallowed by Ink's reconciler and leave a blank screen.
  loadConfig();

  // Test hook: a non-TTY (piped) run has no real width, so force one to match
  // the layout being exercised. Unset in normal use.
  if (process.env.DASH_COLS) {
    (process.stdout as { columns?: number }).columns = Number(process.env.DASH_COLS);
    (process.stdout as { rows?: number }).rows = Number(process.env.DASH_ROWS) || 40;
  }

  const app = render(
    React.createElement(ThemeProvider, null, React.createElement(App)),
  );

  // Test hook: auto-unmount after N ms so a non-interactive run terminates
  // instead of streaming forever. The force-exit that follows makes sure no
  // lingering timer — a stream reconnect, say — keeps the process, and its
  // connection, alive holding the free tier's single slot.
  if (process.env.DASH_EXIT_MS) {
    setTimeout(() => {
      app.unmount();
      setTimeout(() => process.exit(0), 150);
    }, Number(process.env.DASH_EXIT_MS));
  }

  await app.waitUntilExit();
  return 0;
}
