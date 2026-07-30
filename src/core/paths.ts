// Where everything lives. One module, so there is one answer.
//
// The source project resolved paths by walking UP FROM `process.cwd()`, and did
// it independently in six places (config, risk, scanner-config, ui-config,
// watchlist, orders). Two problems with that, beyond the duplication:
//
//   1. It is not actually cwd-independent, despite the comment claiming so. It
//      only works when the cwd happens to sit inside the checkout. Run it from
//      your home directory and the walk finds nothing — or worse, finds some
//      OTHER project's config/ on the way up.
//   2. Six copies drift. `orders.ts` looked for any `package.json`; `config.ts`
//      looked for `config.env`; the scanner used `__dirname` instead. Three
//      different definitions of "the root" in one codebase.
//
// Resolving from this file's own location fixes both: it is genuinely
// independent of where the process was launched, and there is one definition.

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The checked-out repository: the directory holding toreda's package.json. */
function findRepoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url)); // src/core
  for (let i = 0; i < 10; i++) {
    const pkg = join(dir, "package.json");
    if (existsSync(pkg)) {
      try {
        const parsed = JSON.parse(readFileSync(pkg, "utf8")) as { name?: string };
        if (parsed.name === "toreda") return dir;
      } catch {
        // Unreadable or malformed package.json — keep walking rather than
        // treating a broken file as the answer.
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    "Could not locate the toreda repository root from " +
      fileURLToPath(import.meta.url) +
      ". This usually means src/core was moved out of the repo.",
  );
}

export const REPO_ROOT: string = findRepoRoot();

/**
 * Where YOUR data lives: .env, tuned config, journal, logs.
 *
 * Defaults to the repo, which is what makes clone-and-run work with no
 * decisions. `TOREDA_HOME` moves it elsewhere for anyone who would rather keep
 * their trading record outside a git checkout entirely.
 */
export function dataHome(): string {
  const override = process.env.TOREDA_HOME?.trim();
  if (!override) return REPO_ROOT;
  return isAbsolute(override) ? override : resolve(process.cwd(), override);
}

/** The secrets file. Never logged, never committed, chmod 600 on POSIX. */
export function envFile(): string {
  return join(dataHome(), ".env");
}

export function configDir(): string {
  return join(dataHome(), "config");
}

/** A user-tuned config file, e.g. configFile("risk.json"). */
export function configFile(name: string): string {
  return join(configDir(), name);
}

/**
 * The shipped default for a config file, e.g. "risk.default.json".
 *
 * Always read from the REPO, never from TOREDA_HOME: defaults ship with the
 * code and are updated by `git pull`, while the user's copy is theirs.
 */
export function defaultConfigFile(name: string): string {
  return join(REPO_ROOT, "config", name.replace(/\.json$/, ".default.json"));
}

export function journalDir(): string {
  return join(dataHome(), "journal");
}

/** Plain-text order log — every order placed, whether it succeeded or not. */
export function ordersLogFile(): string {
  return join(journalDir(), "orders.log");
}

/** This month's journal file, e.g. journal/2026-07.md. */
export function journalFileFor(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return join(journalDir(), `${year}-${month}.md`);
}

export function logsDir(): string {
  return join(dataHome(), "logs");
}

/** Create the data directories if they are missing. Safe to call repeatedly. */
export function ensureDataDirs(): void {
  for (const dir of [configDir(), journalDir(), logsDir()]) {
    mkdirSync(dir, { recursive: true });
  }
}
