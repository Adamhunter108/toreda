// Credentials and mode, read from .env.
//
// Deliberately tiny: no shell evaluation, no variable interpolation, no dotenv
// dependency. These are KEY=VALUE pairs and nothing more. A config loader that
// can execute things is a liability in a file that holds trading keys.

import { existsSync, readFileSync, statSync } from "node:fs";
import { isDemoMode } from "./demo";
import { envFile } from "./paths";

export type Mode = "live" | "paper";

export interface Config {
  keyId: string;
  secret: string;
  mode: Mode;
  /** Endpoint for account and order operations. Differs by mode. */
  tradeHost: string;
  /** Endpoint for market data. Identical in both modes. */
  dataHost: string;
}

export const TRADE_HOSTS: Record<Mode, string> = {
  live: "https://api.alpaca.markets",
  paper: "https://paper-api.alpaca.markets",
};

export const DATA_HOST = "https://data.alpaca.markets";
export const STREAM_URL = "wss://stream.data.alpaca.markets/v2/iex";

/** Human-readable mode banner. Shown before anything that touches an account. */
export function modeLabel(mode: Mode): string {
  return mode === "live" ? "🚨 LIVE — REAL MONEY" : "📝 PAPER — fake money";
}

export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.replace(/^export\s+/, "").match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = (match[2] ?? "").trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (quoted && value.length >= 2) value = value.slice(1, -1);
    out[match[1]!] = value;
  }
  return out;
}

/**
 * Read .env, letting a real environment variable win over the file.
 *
 * That precedence is load-bearing: `ALPACA_MODE=paper toreda order ...` is the
 * documented way to test against paper without editing anything, and if the
 * file won, that override would silently hit the live account instead.
 */
export function readEnv(): Record<string, string> {
  const path = envFile();
  const fromFile = existsSync(path) ? parseEnvFile(readFileSync(path, "utf8")) : {};
  const merged: Record<string, string> = { ...fromFile };
  for (const key of Object.keys(fromFile)) {
    const live = process.env[key];
    if (live !== undefined && live !== "") merged[key] = live;
  }
  // Variables set in the environment but absent from the file still count.
  for (const key of ["ALPACA_MODE", "TOREDA_HOME"]) {
    const live = process.env[key];
    if (live !== undefined && live !== "") merged[key] = live;
  }
  return merged;
}

/**
 * Which account are we pointed at?
 *
 * Anything that is not exactly "live" — unset, empty, misspelled, mixed case
 * that doesn't normalize — is paper. Reaching real money should require getting
 * it exactly right, and a typo must fail safe rather than fail rich.
 */
export function resolveMode(raw: string | undefined): Mode {
  return raw?.trim().toLowerCase() === "live" ? "live" : "paper";
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

let cache: Config | null = null;

export function loadConfig(reload = false): Config {
  if (cache && !reload) return cache;

  // Demo mode has no credentials and reaches no network, so it must not require
  // a .env — the whole point is seeing toreda before signing up for anything.
  if (isDemoMode()) {
    cache = {
      keyId: "demo",
      secret: "demo",
      mode: "paper",
      tradeHost: TRADE_HOSTS.paper,
      dataHost: DATA_HOST,
    };
    return cache;
  }

  const path = envFile();
  if (!existsSync(path)) {
    throw new ConfigError(
      `No .env found at ${path}\n` +
        `  Run \`npm run setup\` to create one, or copy .env.example and fill it in.`,
    );
  }

  const env = readEnv();
  const mode = resolveMode(env.ALPACA_MODE);
  const keyId = mode === "live" ? env.ALPACA_LIVE_KEY_ID : env.ALPACA_PAPER_KEY_ID;
  const secret = mode === "live" ? env.ALPACA_LIVE_SECRET : env.ALPACA_PAPER_SECRET;

  if (!keyId || !secret) {
    const prefix = mode === "live" ? "ALPACA_LIVE" : "ALPACA_PAPER";
    throw new ConfigError(
      `Missing ${prefix}_KEY_ID / ${prefix}_SECRET in ${path} (ALPACA_MODE=${mode}).\n` +
        `  Run \`npm run setup\`, or add them by hand.`,
    );
  }

  cache = {
    keyId,
    secret,
    mode,
    tradeHost: TRADE_HOSTS[mode],
    dataHost: DATA_HOST,
  };
  return cache;
}

/** Auth headers for every Alpaca call. */
export function authHeaders(cfg = loadConfig()): Record<string, string> {
  return {
    "APCA-API-KEY-ID": cfg.keyId,
    "APCA-API-SECRET-KEY": cfg.secret,
  };
}

export interface PermissionCheck {
  /** False when the file is readable by users other than its owner. */
  secure: boolean;
  /** Null where the concept does not apply, i.e. Windows. */
  mode: string | null;
  detail: string;
}

/**
 * Is .env protected from other users on this machine?
 *
 * POSIX only. Windows uses ACLs, which `mode` does not describe, so reporting a
 * permissions failure there would be a false alarm — and a doctor that cries
 * wolf on a healthy machine is how users learn to ignore it.
 */
export function checkEnvPermissions(): PermissionCheck {
  const path = envFile();
  if (!existsSync(path)) {
    return { secure: false, mode: null, detail: ".env does not exist" };
  }
  if (process.platform === "win32") {
    return {
      secure: true,
      mode: null,
      detail: "n/a on Windows — file access is governed by NTFS ACLs",
    };
  }
  const octal = (statSync(path).mode & 0o777).toString(8).padStart(3, "0");
  const groupOrOther = statSync(path).mode & 0o077;
  return groupOrOther === 0
    ? { secure: true, mode: octal, detail: `chmod ${octal} — owner only` }
    : {
        secure: false,
        mode: octal,
        detail: `chmod ${octal} — readable by others. Fix with: chmod 600 ${path}`,
      };
}
