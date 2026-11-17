// `toreda setup` — first-run configuration.
//
// The core path is SIX questions and ends with a working system. Briefings,
// Telegram, and scheduling are deliberately absent: somebody who wants a
// dashboard and a scanner should never have to read the word "Telegram" to get
// one. Those live behind `toreda setup briefings`.

import { chmodSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAccount, getPositions } from "../../core/alpaca";
import { loadConfig, parseEnvFile, TRADE_HOSTS, type Mode } from "../../core/config";
import { getJson } from "../../core/http";
import { getQuotes } from "../../core/market-data";
import { saveJsonConfig } from "../../core/json-config";
import { ensureDataDirs, envFile, REPO_ROOT } from "../../core/paths";
import { DEFAULT_RISK_RULES, type RiskRules } from "../../core/risk";
import { THEME_ORDER, THEMES } from "../../core/theme";
import type { ParsedArgs } from "../args";
import { c, out, themed } from "../format";
import {
  CancelledError,
  confirm,
  number,
  requireInteractive,
  rule,
  say,
  secret,
  select,
  step,
  text,
} from "../prompt";

const TOTAL_STEPS = 6;

interface Answers {
  mode: Mode;
  paperKeyId: string;
  paperSecret: string;
  liveKeyId: string;
  liveSecret: string;
}

// ── Step 1: Alpaca credentials ──────────────────────────────────────────────

/**
 * Verify a key pair against Alpaca before writing it.
 *
 * Setup that "succeeds" with a typo'd key produces a system that fails on every
 * later command with an opaque 401, and the user has no reason to suspect the
 * step they already completed.
 */
async function verifyKeys(
  mode: Mode,
  keyId: string,
  secretKey: string,
): Promise<{ ok: true; account: string; equity: number } | { ok: false; reason: string }> {
  const headers = { "APCA-API-KEY-ID": keyId, "APCA-API-SECRET-KEY": secretKey };
  try {
    const data = await getJson<Record<string, unknown>>(`${TRADE_HOSTS[mode]}/v2/account`, {
      headers,
      retries: 1,
    });
    if (typeof data.account_number !== "string") {
      return { ok: false, reason: "Alpaca responded, but not with an account." };
    }
    return { ok: true, account: data.account_number, equity: Number(data.equity) || 0 };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/40[13]/.test(message)) {
      return {
        ok: false,
        reason:
          `Alpaca rejected those keys for the ${mode} account.\n` +
          `    Check you copied them from the ${mode === "paper" ? "PAPER" : "LIVE"} ` +
          `section of the dashboard — paper and live keys are different.`,
      };
    }
    return { ok: false, reason: message };
  }
}

async function askKeys(mode: Mode): Promise<{ keyId: string; secret: string }> {
  const label = mode === "paper" ? "paper" : "live";
  for (;;) {
    const keyId = await text(`${label} API key ID`);
    const secretKey = await secret(`${label} API secret`);

    out(c.dim("    checking with Alpaca…"));
    const result = await verifyKeys(mode, keyId, secretKey);
    if (result.ok) {
      out(
        `    ${c.green("✓")} Connected to account ${c.bold(result.account)} ` +
          c.dim(`(equity $${result.equity.toLocaleString("en-US", { minimumFractionDigits: 2 })})`),
      );
      return { keyId, secret: secretKey };
    }
    out(`    ${c.red("✗")} ${result.reason}`);
    if (!(await confirm("Try again?", true))) throw new CancelledError();
  }
}

async function stepCredentials(): Promise<Answers> {
  step(1, TOTAL_STEPS, "Connect your Alpaca account");
  say(
    "",
    "toreda trades through Alpaca. If you don't have an account yet:",
    `  ${c.cyan("https://alpaca.markets")} — free, and paper trading needs no deposit.`,
    "",
    "Find your keys in the Alpaca dashboard under " + c.bold("API Keys") + ".",
    c.dim("Paper and live have separate keys — make sure you're on the right one."),
  );

  const mode = await select<Mode>(
    "Which account should toreda use?",
    [
      {
        label: `${c.green("Paper")} — fake money`,
        value: "paper",
        hint: "recommended: everything works, nothing is at risk",
      },
      { label: `${c.red("Live")} — real money`, value: "live", hint: "requires typing LIVE" },
    ],
    0,
  );

  if (mode === "live") {
    say(
      "",
      c.red(c.bold("This will place real orders with real money.")),
      c.dim("Every order still previews first and needs --confirm to send."),
      "",
    );
    // Typed, not selected. Choosing live from a menu is one keystroke away from
    // choosing paper; typing the word is not.
    const typed = await text('Type LIVE to confirm, or anything else to use paper');
    if (typed !== "LIVE") {
      say(c.yellow("    Not confirmed — using paper. You can switch later in .env."));
      const paper = await askKeys("paper");
      return {
        mode: "paper",
        paperKeyId: paper.keyId,
        paperSecret: paper.secret,
        liveKeyId: "",
        liveSecret: "",
      };
    }
    const live = await askKeys("live");
    say("", c.dim("You can also add paper keys, to test without risking anything."));
    if (await confirm("Add paper keys too?", true)) {
      const paper = await askKeys("paper");
      return {
        mode: "live",
        liveKeyId: live.keyId,
        liveSecret: live.secret,
        paperKeyId: paper.keyId,
        paperSecret: paper.secret,
      };
    }
    return {
      mode: "live",
      liveKeyId: live.keyId,
      liveSecret: live.secret,
      paperKeyId: "",
      paperSecret: "",
    };
  }

  const paper = await askKeys("paper");
  return {
    mode: "paper",
    paperKeyId: paper.keyId,
    paperSecret: paper.secret,
    liveKeyId: "",
    liveSecret: "",
  };
}

// ── Step 2: Watchlist ───────────────────────────────────────────────────────

interface PresetFile {
  _comment?: string[];
  sectors: Record<string, string[]>;
}

export function loadPreset(name: string): PresetFile | null {
  const path = join(REPO_ROOT, "config", "presets", `${name}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as PresetFile;
  } catch {
    return null;
  }
}

export function listPresets(): string[] {
  const dir = join(REPO_ROOT, "config", "presets");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();
}

async function stepWatchlist(): Promise<PresetFile> {
  step(2, TOTAL_STEPS, "Choose a watchlist");
  say(
    "",
    "The watchlist is what the scanner and dashboard watch.",
    c.dim("You can change it any time with `toreda watchlist add/remove`."),
  );

  const choice = await select<string>(
    "Where would you like to start?",
    [
      {
        label: "Broad market",
        value: "broad-market",
        hint: "25 liquid names across 8 sectors",
      },
      { label: "Technology & AI", value: "technology", hint: "21 names, concentrated" },
      { label: "Dividend & value", value: "dividend-value", hint: "25 slower-moving names" },
      { label: "Import my current positions", value: "import", hint: "whatever you already hold" },
      { label: "Start empty", value: "empty", hint: "add symbols yourself" },
    ],
    0,
  );

  if (choice === "empty") return { sectors: {} };

  if (choice === "import") {
    try {
      const positions = await getPositions();
      if (positions.length === 0) {
        say(c.yellow("    No open positions found — starting with the broad-market preset."));
        return loadPreset("broad-market") ?? { sectors: {} };
      }
      say(`    ${c.green("✓")} Imported ${positions.length} held symbols.`);
      return { sectors: { Holdings: positions.map((p) => p.symbol).sort() } };
    } catch {
      say(c.yellow("    Could not read positions — starting with the broad-market preset."));
      return loadPreset("broad-market") ?? { sectors: {} };
    }
  }

  const preset = loadPreset(choice);
  if (!preset) {
    say(c.yellow(`    Preset ${choice} not found — starting empty.`));
    return { sectors: {} };
  }
  const count = Object.values(preset.sectors).flat().length;
  say(`    ${c.green("✓")} ${count} symbols across ${Object.keys(preset.sectors).length} sectors.`);
  return preset;
}

// ── Step 3: Risk rules ──────────────────────────────────────────────────────

async function stepRisk(): Promise<RiskRules> {
  step(3, TOTAL_STEPS, "Set your risk rules");
  say(
    "",
    "These don't block anything — orders place whatever you confirm.",
    "They decide when the scanner taps you on the shoulder.",
    "",
    c.dim("A threshold you intend to ignore is worse than none: it trains you"),
    c.dim("to skim past the block where real breaches appear."),
  );

  const stopLossPct = await number("Sell a position when it falls this far below entry (%)", {
    default: DEFAULT_RISK_RULES.stopLossPct,
    min: -90,
    max: -1,
  });
  const maxWeightPct = await number("Largest share of your portfolio one symbol may be (%)", {
    default: DEFAULT_RISK_RULES.defaultMaxWeight * 100,
    min: 1,
    max: 100,
  });
  const trimProfitPct = await number("Consider trimming an oversized winner above this gain (%)", {
    default: DEFAULT_RISK_RULES.trimProfitPct,
    min: 1,
    max: 1000,
  });

  return {
    stopLossPct,
    defaultMaxWeight: maxWeightPct / 100,
    trimProfitPct,
    overrides: {},
    stopOverrides: {},
  };
}

// ── Step 4: Theme ───────────────────────────────────────────────────────────

async function stepTheme(): Promise<string> {
  step(4, TOTAL_STEPS, "Pick a colour theme");
  say("", c.dim("Used by the dashboard. Change it any time with `t` inside `toreda dash`."));

  return select<string>(
    "Theme",
    THEME_ORDER.map((name) => {
      const theme = THEMES[name]!;
      // Render the theme's OWN colours rather than describing them. Picking a
      // palette from four names is guesswork; picking it from four palettes is
      // just looking.
      const swatch =
        `${themed(theme.positive, "● gain")} ${themed(theme.negative, "● loss")} ` +
        `${themed(theme.warning, "● warn")} ${themed(theme.accent, "● accent")}`;
      return {
        label: name.padEnd(10),
        value: name,
        hint:
          name === "Default" ? `${swatch}  ${c.dim("(your terminal's own)")}` : swatch,
      };
    }),
    THEME_ORDER.indexOf("Default"),
  );
}

// ── Step 5: Write ───────────────────────────────────────────────────────────

/** Build .env text, preserving any optional values already present. */
export function buildEnvFile(answers: Answers, existing: Record<string, string> = {}): string {
  const keep = (key: string): string => existing[key] ?? "";
  return [
    "# toreda configuration. Written by `toreda setup`.",
    "# This file holds API keys — never commit it or paste its contents anywhere.",
    "",
    "# Paper trading (fake money)",
    `ALPACA_PAPER_KEY_ID=${answers.paperKeyId}`,
    `ALPACA_PAPER_SECRET=${answers.paperSecret}`,
    "",
    "# Live trading (REAL money)",
    `ALPACA_LIVE_KEY_ID=${answers.liveKeyId}`,
    `ALPACA_LIVE_SECRET=${answers.liveSecret}`,
    "",
    "# Which account every command talks to: paper or live.",
    "# Anything other than exactly `live` is treated as paper.",
    `ALPACA_MODE=${answers.mode}`,
    "",
    "# ── Optional. toreda is fully functional without any of these. ──",
    "",
    "# Telegram briefing delivery — see docs/briefings.md",
    `TELEGRAM_BOT_TOKEN=${keep("TELEGRAM_BOT_TOKEN")}`,
    `TELEGRAM_CHAT_ID=${keep("TELEGRAM_CHAT_ID")}`,
    "",
    "# Claude commentary in briefings. Generate with: claude setup-token",
    `CLAUDE_CODE_OAUTH_TOKEN=${keep("CLAUDE_CODE_OAUTH_TOKEN")}`,
    "",
  ].join("\n");
}

function writeEnv(answers: Answers): void {
  const path = envFile();
  const existing = existsSync(path) ? parseEnvFile(readFileSync(path, "utf8")) : {};
  writeFileSync(path, buildEnvFile(answers, existing));
  // chmod is meaningless on Windows (NTFS uses ACLs), and calling it there
  // would report a success that means nothing.
  if (process.platform !== "win32") chmodSync(path, 0o600);
}

// ── Orchestration ───────────────────────────────────────────────────────────

async function runCoreSetup(): Promise<number> {
  out("");
  rule();
  out(`  ${c.bold("toreda setup")}`);
  say(c.dim("Six questions, then you're running."));
  rule();

  const path = envFile();
  if (existsSync(path)) {
    say("", c.yellow(`An existing configuration was found at ${path}`));
    if (!(await confirm("Overwrite it?", false))) {
      say(c.dim("Nothing changed."), "");
      return 0;
    }
  }

  ensureDataDirs();

  const answers = await stepCredentials();
  writeEnv(answers);

  const watchlist = await stepWatchlist();
  const risk = await stepRisk();
  const theme = await stepTheme();

  step(5, TOTAL_STEPS, "Save your configuration");
  saveJsonConfig("watchlist.json", watchlist);
  saveJsonConfig("risk.json", risk);
  saveJsonConfig("ui.json", { theme });
  say(
    "",
    `${c.green("✓")} ${path} ` + c.dim(process.platform === "win32" ? "" : "(chmod 600)"),
    `${c.green("✓")} config/watchlist.json, risk.json, ui.json`,
  );

  step(6, TOTAL_STEPS, "Check everything works");
  const checks = await verifySetup(answers.mode);
  for (const check of checks) out(`  ${check}`);

  out("");
  rule();
  out(`  ${c.bold(c.green("Setup complete."))}`);
  out("");
  say(
    "Try these:",
    `  ${c.cyan("npm run toreda -- portfolio")}   ${c.dim("your positions")}`,
    `  ${c.cyan("npm run toreda -- scan")}        ${c.dim("what's moving, and what it means for you")}`,
    `  ${c.cyan("npm run dash")}                  ${c.dim("the live dashboard")}`,
    `  ${c.cyan("npm run doctor")}                ${c.dim("re-check your setup any time")}`,
    "",
    c.dim("For a bare `toreda` command instead of `npm run toreda --`, run: npm link"),
  );
  rule();

  // Mentioned only AFTER the system works. Briefings are worth knowing about —
  // scheduled market-open and market-close summaries — but setting up a
  // Telegram bot is a multi-minute detour, and putting it between a new user
  // and a working install is how people abandon setup halfway.
  out("");
  say(
    c.bold("Optional:") + " scheduled market briefings, delivered wherever you want",
    c.dim("  — your terminal, a file, a desktop notification, or Telegram."),
    `  Set them up any time with ${c.cyan("npm run toreda -- setup briefings")}`,
  );
  out("");
  return 0;
}

async function verifySetup(mode: Mode): Promise<string[]> {
  const results: string[] = [];
  // Reload so these checks read the .env that was just written, not whatever
  // was cached from before the wizard ran.
  loadConfig(true);

  try {
    const account = await getAccount();
    results.push(
      `${c.green("✓")} Trading API — account ${account.accountNumber} (${account.status})`,
    );
  } catch (err) {
    results.push(`${c.red("✗")} Trading API — ${err instanceof Error ? err.message : err}`);
  }

  // Market data is a separate entitlement from trading, so a working trading
  // key does not imply a working data key. Check it rather than assume it.
  try {
    const quotes = await getQuotes(["SPY"]);
    results.push(
      quotes.length > 0
        ? `${c.green("✓")} Market data API`
        : `${c.yellow("⚠")} Market data API responded but returned no quote for SPY`,
    );
  } catch (err) {
    results.push(`${c.red("✗")} Market data API — ${err instanceof Error ? err.message : err}`);
  }

  results.push(`${c.green("✓")} Mode: ${mode}`);
  return results;
}

export async function run(args: ParsedArgs): Promise<number> {
  const sub = args.positionals[0];

  if (sub === "briefings") {
    requireInteractive();
    const { runBriefingSetup } = await import("./setup-briefings");
    try {
      return await runBriefingSetup();
    } catch (err) {
      if (err instanceof CancelledError) {
        out("", c.yellow("  Cancelled — nothing was changed."), "");
        return 130;
      }
      throw err;
    }
  }
  if (sub !== undefined) {
    out("", c.red(`  Unknown setup subcommand: ${sub}`), c.dim("  Usage: toreda setup [briefings]"), "");
    return 1;
  }

  requireInteractive();
  try {
    return await runCoreSetup();
  } catch (err) {
    if (err instanceof CancelledError) {
      out("", c.yellow("  Setup cancelled — nothing was changed beyond this point."), "");
      return 130;
    }
    throw err;
  }
}
