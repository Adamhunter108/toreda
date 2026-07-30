// The watchlist: config/watchlist.json, the single source of truth for which
// symbols this system pays attention to.
//
// Everything that needs a symbol universe reads this one file — the CLI's quote
// table, the scanner, and the dashboard. The source project's hardest-won
// lesson here was that three separate lists had drifted apart, so there is
// exactly one, and adding a symbol anywhere means adding it here.
//
// Open positions are ALWAYS scanned whether or not they appear in this file.
// You cannot stop watching something you own by deleting a line.

import { existsSync, readFileSync } from "node:fs";
import { configFile, defaultConfigFile } from "./paths";
import { saveJsonConfig } from "./json-config";

export interface WatchlistFile {
  /** Free-text notes preserved across edits. */
  _comment?: string[];
  sectors: Record<string, string[]>;
}

export interface Watchlist {
  symbols: string[];
  /** symbol → sector name, for labelling signals. */
  sectorOf: Record<string, string>;
  sectors: string[];
}

const EMPTY: WatchlistFile = { sectors: {} };

/** Where new symbols land when added without a sector. */
export const DEFAULT_SECTOR = "Added";

function readFile(): { path: string; data: WatchlistFile } {
  const userPath = configFile("watchlist.json");
  const path = existsSync(userPath) ? userPath : defaultConfigFile("watchlist.json");
  if (!existsSync(path)) return { path: userPath, data: { ...EMPTY } };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<WatchlistFile>;
    const sectors: Record<string, string[]> = {};
    for (const [name, syms] of Object.entries(parsed.sectors ?? {})) {
      if (!Array.isArray(syms)) continue;
      sectors[name] = syms.filter((s): s is string => typeof s === "string");
    }
    return {
      path: userPath,
      data: { ...(parsed._comment ? { _comment: parsed._comment } : {}), sectors },
    };
  } catch {
    // A broken watchlist should not take the whole tool down mid-session.
    return { path: userPath, data: { ...EMPTY } };
  }
}

export function loadWatchlist(): Watchlist {
  const { data } = readFile();
  const sectorOf: Record<string, string> = {};
  for (const [sector, syms] of Object.entries(data.sectors)) {
    for (const s of syms) sectorOf[s.toUpperCase()] = sector;
  }
  return {
    symbols: Object.keys(sectorOf).sort(),
    sectorOf,
    sectors: Object.keys(data.sectors),
  };
}

export function loadWatchlistSymbols(): string[] {
  return loadWatchlist().symbols;
}

export function loadWatchlistSectors(): string[] {
  return loadWatchlist().sectors;
}

/** Add a symbol. Idempotent — returns false if it was already tracked. */
export function addWatchlistSymbol(symbol: string, sector = DEFAULT_SECTOR): boolean {
  const s = symbol.trim().toUpperCase();
  if (!s) return false;
  const { data } = readFile();
  for (const syms of Object.values(data.sectors)) {
    if (syms.includes(s)) return false;
  }
  const target = (data.sectors[sector] ??= []);
  target.push(s);
  target.sort();
  saveJsonConfig("watchlist.json", data);
  return true;
}

/** Remove a symbol from every sector it appears in. */
export function removeWatchlistSymbol(symbol: string): boolean {
  const s = symbol.trim().toUpperCase();
  const { data } = readFile();
  let removed = false;
  for (const sector of Object.keys(data.sectors)) {
    const before = data.sectors[sector]!.length;
    data.sectors[sector] = data.sectors[sector]!.filter((x) => x !== s);
    if (data.sectors[sector]!.length !== before) removed = true;
    // Tidy up an emptied auto-created sector, but never a user's own.
    if (data.sectors[sector]!.length === 0 && sector === DEFAULT_SECTOR) {
      delete data.sectors[sector];
    }
  }
  if (removed) saveJsonConfig("watchlist.json", data);
  return removed;
}
