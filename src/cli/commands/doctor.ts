// `toreda doctor` — what's wired up, and what isn't.
//
// The rule that shapes this whole command: an unconfigured OPTIONAL feature
// reports as "off", never as a fault.
//
// The tempting bug here is instructive. If scheduled briefings are installed on
// one machine, a naive doctor reports their absence on every OTHER machine as
// broken — and the obvious fix is a setting telling doctor which machine is
// special. That solves the symptom. The real problem is that absence was being
// read as failure. Treating an unconfigured optional as `off` needs no
// per-machine configuration at all, and is correct for every user by default.

import { existsSync } from "node:fs";
import { arch, platform, release } from "node:os";
import { getAccount, getClock } from "../../core/alpaca";
import { checkEnvPermissions, loadConfig, modeLabel, readEnv } from "../../core/config";
import { fundsOf } from "../../core/funds";
import { getQuotes } from "../../core/market-data";
import { configFile, dataHome, envFile, REPO_ROOT } from "../../core/paths";
import { loadRiskRules } from "../../core/risk";
import { loadScannerConfig } from "../../core/scanner-config";
import { loadUiConfig } from "../../core/ui-config";
import { loadWatchlist } from "../../core/watchlist";
import type { ParsedArgs } from "../args";
import { c, out } from "../format";

type Status = "ok" | "warn" | "bad" | "off";

interface Check {
  status: Status;
  label: string;
  detail?: string;
  fix?: string;
}

const MARKS: Record<Status, string> = {
  ok: c.green("✓"),
  warn: c.yellow("⚠"),
  bad: c.red("✗"),
  off: c.dim("○"),
};

function section(title: string, checks: Check[]): void {
  out("", c.bold(title));
  for (const check of checks) {
    const detail = check.detail ? `  ${c.dim(check.detail)}` : "";
    out(`  ${MARKS[check.status]} ${check.label}${detail}`);
    if (check.fix) out(`      ${c.cyan(check.fix)}`);
  }
}

// ── Environment ─────────────────────────────────────────────────────────────

function environmentChecks(): Check[] {
  const checks: Check[] = [];
  const major = Number(process.versions.node.split(".")[0]);

  checks.push({
    status: major >= 22 ? "ok" : "bad",
    label: `Node ${process.versions.node}`,
    detail: major >= 22 ? undefined : "toreda needs Node 22 or newer",
    ...(major >= 22 ? {} : { fix: "Install Node 22+: https://nodejs.org" }),
  });

  checks.push({
    status: "ok",
    label: `${platform()} ${arch()}`,
    detail: release(),
  });

  // Windows Terminal renders the dashboard's box drawing and block characters
  // correctly; the legacy console host does not. Detect rather than let the
  // dashboard render as mojibake with no explanation.
  if (platform() === "win32") {
    const modern = Boolean(process.env.WT_SESSION || process.env.TERM_PROGRAM);
    checks.push({
      status: modern ? "ok" : "warn",
      label: modern ? "Windows Terminal detected" : "Terminal may not render the dashboard",
      detail: modern ? undefined : "legacy conhost.exe garbles box-drawing characters",
      ...(modern ? {} : { fix: "Use Windows Terminal for `toreda dash`" }),
    });
  }

  checks.push({
    status: "ok",
    label: "Data directory",
    detail: dataHome() === REPO_ROOT ? `${dataHome()} (repo)` : `${dataHome()} (TOREDA_HOME)`,
  });

  return checks;
}

// ── Configuration ───────────────────────────────────────────────────────────

function configChecks(): Check[] {
  const checks: Check[] = [];
  const path = envFile();

  if (!existsSync(path)) {
    return [
      {
        status: "bad",
        label: ".env not found",
        detail: path,
        fix: "npm run setup",
      },
    ];
  }

  const perms = checkEnvPermissions();
  checks.push({
    status: perms.secure ? "ok" : "warn",
    label: ".env permissions",
    detail: perms.detail,
  });

  try {
    const cfg = loadConfig(true);
    checks.push({
      status: "ok",
      label: `Mode: ${cfg.mode}`,
      detail: modeLabel(cfg.mode),
    });

    // Having live keys on file while pointed at paper is fine and common; the
    // reverse — mode=live with no live keys — would have failed loadConfig.
    const env = readEnv();
    const hasPaper = Boolean(env.ALPACA_PAPER_KEY_ID && env.ALPACA_PAPER_SECRET);
    const hasLive = Boolean(env.ALPACA_LIVE_KEY_ID && env.ALPACA_LIVE_SECRET);
    checks.push({
      status: hasPaper ? "ok" : "warn",
      label: hasPaper ? "Paper keys present" : "No paper keys",
      detail: hasPaper ? undefined : "you cannot test safely without them",
    });
    checks.push({
      status: hasLive ? "ok" : "off",
      label: hasLive ? "Live keys present" : "Live keys not configured",
    });
  } catch (err) {
    checks.push({
      status: "bad",
      label: "Credentials",
      detail: err instanceof Error ? err.message.split("\n")[0] : String(err),
      fix: "npm run setup",
    });
  }

  return checks;
}

function configFileChecks(): Check[] {
  const checks: Check[] = [];

  const watchlist = loadWatchlist();
  const usingDefaults = !existsSync(configFile("watchlist.json"));
  checks.push({
    status: watchlist.symbols.length > 0 ? "ok" : "warn",
    label: `Watchlist — ${watchlist.symbols.length} symbols, ${watchlist.sectors.length} sectors`,
    detail: usingDefaults ? "using shipped defaults" : undefined,
    ...(watchlist.symbols.length === 0
      ? { fix: "toreda watchlist add NVDA" }
      : {}),
  });

  const risk = loadRiskRules();
  const overrideCount = Object.keys(risk.overrides).length;
  const stopCount = Object.keys(risk.stopOverrides).length;
  checks.push({
    status: "ok",
    label: "Risk rules",
    detail:
      `stop ${risk.stopLossPct}%, max ${(risk.defaultMaxWeight * 100).toFixed(0)}% per symbol` +
      (overrideCount ? `, ${overrideCount} override${overrideCount > 1 ? "s" : ""}` : "") +
      (stopCount ? `, ${stopCount} stop exception${stopCount > 1 ? "s" : ""}` : ""),
  });

  const scanner = loadScannerConfig();
  const enabled = Object.entries(scanner.signalTypes)
    .filter(([, on]) => on)
    .map(([name]) => name.replace(/_/g, " "));
  checks.push({
    status: enabled.length > 0 ? "ok" : "warn",
    label: `Scanner — ${enabled.length}/4 signal types`,
    detail: enabled.length ? enabled.join(", ") : "all signal types are off",
  });

  checks.push({ status: "ok", label: `Theme — ${loadUiConfig().theme}` });

  return checks;
}

// ── Connectivity ────────────────────────────────────────────────────────────

async function connectivityChecks(): Promise<Check[]> {
  const checks: Check[] = [];

  try {
    const account = await getAccount();
    const funds = fundsOf(account);
    const money = (n: number): string => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
    checks.push({
      status: account.status === "ACTIVE" ? "ok" : "warn",
      label: `Trading API — account ${account.accountNumber}`,
      detail:
        `${account.status}, equity ${money(account.equity)}, cash ${money(funds.cash)}` +
        (funds.margin > 0 ? ` (+${money(funds.margin)} margin)` : ""),
    });
  } catch (err) {
    checks.push({
      status: "bad",
      label: "Trading API unreachable",
      detail: err instanceof Error ? err.message.slice(0, 100) : String(err),
      fix: "Check your keys and network, then re-run",
    });
    // Without trading access the rest cannot be meaningfully tested.
    return checks;
  }

  try {
    const quotes = await getQuotes(["SPY"]);
    checks.push({
      status: quotes.length > 0 ? "ok" : "warn",
      label: "Market data API",
      detail: quotes.length > 0 ? `SPY mid $${quotes[0]!.mid.toFixed(2)}` : "no quote returned",
    });
  } catch (err) {
    checks.push({
      status: "bad",
      label: "Market data API unreachable",
      detail: err instanceof Error ? err.message.slice(0, 100) : String(err),
    });
  }

  try {
    const clock = await getClock();
    checks.push({
      status: "ok",
      label: clock.isOpen ? "Market is OPEN" : "Market is closed",
      detail: clock.isOpen
        ? `closes ${new Date(clock.nextClose).toLocaleString()}`
        : `opens ${new Date(clock.nextOpen).toLocaleString()}`,
    });
  } catch {
    checks.push({ status: "warn", label: "Could not read the market clock" });
  }

  return checks;
}

// ── Optional features ───────────────────────────────────────────────────────

/**
 * Everything here is opt-in, so "not configured" is reported as `off`, never as
 * a warning or a failure. A doctor that cries wolf about features you never
 * asked for is a doctor you stop reading.
 */
function optionalChecks(): Check[] {
  const env = readEnv();
  const checks: Check[] = [];

  const telegram = Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID);
  checks.push({
    status: telegram ? "ok" : "off",
    label: telegram ? "Telegram delivery configured" : "Telegram delivery — off",
    detail: telegram ? undefined : "briefings print to your terminal instead",
  });

  const claudeToken = Boolean(env.CLAUDE_CODE_OAUTH_TOKEN?.startsWith("sk-ant"));
  checks.push({
    status: claudeToken ? "ok" : "off",
    label: claudeToken ? "Claude briefing commentary configured" : "Claude commentary — off",
    detail: claudeToken ? undefined : "briefings would carry data without written commentary",
  });

  return checks;
}

// ── Entry point ─────────────────────────────────────────────────────────────

export async function run(_args: ParsedArgs): Promise<number> {
  out("", c.bold("toreda doctor"));

  const env = environmentChecks();
  section("Environment", env);

  const config = configChecks();
  section("Configuration", config);

  // Everything below needs credentials; without them the failures would be
  // noise restating the same missing .env.
  const configBroken = config.some((check) => check.status === "bad");
  if (configBroken) {
    out("", c.yellow("  Fix the above first — the remaining checks need credentials."), "");
    return 1;
  }

  // Run each group ONCE and reuse the results for the summary — recomputing
  // would re-hit the API and could even disagree with what was just printed.
  const files = configFileChecks();
  section("Files", files);

  const connectivity = await connectivityChecks();
  section("Connectivity", connectivity);

  const optional = optionalChecks();
  section("Optional features", optional);

  const all = [...env, ...config, ...files, ...connectivity, ...optional];
  const bad = all.filter((check) => check.status === "bad").length;
  const warn = all.filter((check) => check.status === "warn").length;

  out("");
  if (bad > 0) {
    out(`  ${c.red(`${bad} problem${bad > 1 ? "s" : ""}`)} to fix.`, "");
    return 1;
  }
  if (warn > 0) {
    out(`  ${c.yellow(`${warn} warning${warn > 1 ? "s" : ""}`)} — usable, but worth a look.`, "");
    return 0;
  }
  out(`  ${c.green("Everything checks out.")}`, "");
  return 0;
}
