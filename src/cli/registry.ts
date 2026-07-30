// The command surface, as data.
//
// Kept separate from the dispatcher so that help text, the Claude Code
// permission allowlist, and the docs can all be generated from one list rather
// than drifting apart. `writes` is the field that matters most: it marks the
// commands that can change your account, and it is what keeps `order --confirm`
// out of any generated allowlist.

import type { ParsedArgs } from "./args";

export type CommandGroup = "Account" | "Analysis" | "Trading" | "Setup";

/** Every command receives the fully parsed arguments and returns an exit code. */
export type CommandModule = {
  run: (args: ParsedArgs) => Promise<number | void>;
};

export interface Command {
  name: string;
  group: CommandGroup;
  summary: string;
  usage: string;
  /** Flags that take a following value, passed through to the arg parser. */
  valueFlags?: readonly string[];
  /**
   * True when the command can mutate the account or place an order. Read-only
   * commands are safe to pre-approve; these are never auto-approved.
   */
  writes?: boolean;
  /**
   * True when the command takes over the terminal or waits on a human.
   *
   * Separate from `writes` because the reason differs: these are perfectly safe,
   * but an agent that runs one blocks until the human quits it. They belong to
   * the person at the keyboard, so they stay out of any allowlist.
   */
  interactive?: boolean;
  /** Loaded lazily so a `toreda quote` run never imports the dashboard. */
  load?: () => Promise<CommandModule>;
}

export const COMMANDS: readonly Command[] = [
  // ── Account ───────────────────────────────────────────────────────────────
  {
    name: "account",
    group: "Account",
    summary: "Buying power, cash, and portfolio value",
    usage: "toreda account",
    load: () => import("./commands/account"),
  },
  {
    name: "portfolio",
    group: "Account",
    summary: "Open positions with profit and loss",
    usage: "toreda portfolio",
    load: () => import("./commands/portfolio"),
  },
  {
    name: "history",
    group: "Account",
    summary: "Recent orders and their fills",
    usage: "toreda history [N]",
    load: () => import("./commands/history"),
  },

  // ── Analysis ──────────────────────────────────────────────────────────────
  {
    name: "quote",
    group: "Analysis",
    summary: "Live quotes for one or more symbols",
    usage: "toreda quote NVDA AMD",
    load: () => import("./commands/quote"),
  },
  {
    name: "watchlist",
    group: "Analysis",
    summary: "Quotes across your whole watchlist",
    usage: "toreda watchlist [add SYM | remove SYM]",
    load: () => import("./commands/watchlist"),
  },
  {
    name: "scan",
    group: "Analysis",
    summary: "Ranked opportunity signals and rule breaches",
    usage: "toreda scan [--no-discovery] [--json]",
    load: () => import("./commands/scan"),
  },
  {
    name: "dash",
    group: "Analysis",
    summary: "The live terminal dashboard",
    usage: "toreda dash",
    interactive: true,
    load: () => import("./commands/dash"),
  },
  {
    name: "brief",
    group: "Analysis",
    summary: "Generate a market briefing (prints; delivery is opt-in)",
    usage: "toreda brief [open|close] [--out FILE] [--notify] [--telegram]",
    valueFlags: ["out"],
    load: () => import("./commands/brief"),
  },

  // ── Trading ───────────────────────────────────────────────────────────────
  {
    name: "order",
    group: "Trading",
    summary: "Place an order — previews unless you pass --confirm",
    usage: "toreda order SYMBOL buy|sell QTY [limit PRICE] [--confirm]",
    writes: true,
    load: () => import("./commands/order"),
  },

  // ── Setup ─────────────────────────────────────────────────────────────────
  {
    name: "setup",
    group: "Setup",
    summary: "Interactive first-run configuration",
    usage: "toreda setup [briefings]",
    interactive: true,
    load: () => import("./commands/setup"),
  },
  {
    name: "doctor",
    group: "Setup",
    summary: "Check your environment, keys, and connectivity",
    usage: "toreda doctor",
    load: () => import("./commands/doctor"),
  },
  {
    name: "schedule",
    group: "Setup",
    summary: "Install or remove scheduled briefings (optional)",
    usage: "toreda schedule install [--dry-run] | status | uninstall",
    interactive: true,
    load: () => import("./commands/schedule"),
  },
];

export function findCommand(name: string): Command | undefined {
  return COMMANDS.find((c) => c.name === name);
}

/** Commands that cannot change anything. */
export function readOnlyCommands(): readonly Command[] {
  return COMMANDS.filter((c) => !c.writes);
}

/**
 * Commands safe to pre-approve in .claude/settings.json: read-only AND
 * non-interactive. Two separate reasons for exclusion, deliberately kept
 * separate — `order` is excluded because it can move money, `dash` because an
 * agent that launches it blocks until a human quits.
 */
export function preApprovableCommands(): readonly Command[] {
  return COMMANDS.filter((c) => !c.writes && !c.interactive);
}
