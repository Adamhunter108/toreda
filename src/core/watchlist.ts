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
//
// `order` is display only: the sequence the dashboard shows when the watchlist
// is sorted by "your order". Sectors stay the grouping the scanner uses, so
// reordering never moves a symbol between sectors.

import { existsSync, readFileSync } from "node:fs";
import { configFile, defaultConfigFile } from "./paths";
import { saveJsonConfig } from "./json-config";

export interface WatchlistFile {
  /** Free-text notes preserved across edits. */
  _comment?: string[];
  sectors: Record<string, string[]>;
  /** Your display order, set from the dashboard. Optional; see `orderOf`. */
  order?: string[];
}

export interface Watchlist {
  /** Every tracked symbol, alphabetical. */
  symbols: string[];
  /** The same symbols in your display order. */
  ordered: string[];
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
    const order = Array.isArray(parsed.order)
      ? parsed.order.filter((s): s is string => typeof s === "string")
      : undefined;
    return {
      path: userPath,
      data: {
        ...(parsed._comment ? { _comment: parsed._comment } : {}),
        sectors,
        ...(order ? { order } : {}),
      },
    };
  } catch {
    // A broken watchlist should not take the whole tool down mid-session.
    return { path: userPath, data: { ...EMPTY } };
  }
}

/**
 * Every tracked symbol in display order: the ones named in `order` first, then
 * the rest as the file lists them, sector by sector.
 *
 * `order` is advisory. A name in it that is no longer tracked is skipped, and a
 * symbol added by hand or from the CLI without touching `order` still shows up,
 * at the end, rather than disappearing from the panel.
 */
function orderOf(data: WatchlistFile): string[] {
  const tracked: string[] = [];
  const seen = new Set<string>();
  for (const syms of Object.values(data.sectors)) {
    for (const raw of syms) {
      const s = raw.toUpperCase();
      if (!seen.has(s)) {
        seen.add(s);
        tracked.push(s);
      }
    }
  }
  const placed = new Set<string>();
  for (const raw of data.order ?? []) {
    const s = raw.toUpperCase();
    if (seen.has(s)) placed.add(s);
  }
  return [...placed, ...tracked.filter((s) => !placed.has(s))];
}

export function loadWatchlist(): Watchlist {
  const { data } = readFile();
  const sectorOf: Record<string, string> = {};
  for (const [sector, syms] of Object.entries(data.sectors)) {
    for (const s of syms) sectorOf[s.toUpperCase()] = sector;
  }
  return {
    symbols: Object.keys(sectorOf).sort(),
    ordered: orderOf(data),
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
  if (data.order) data.order = data.order.filter((x) => x.toUpperCase() !== s);
  if (removed) saveJsonConfig("watchlist.json", data);
  return removed;
}

/**
 * Move a symbol `by` places in the display order (negative is up), clamped to
 * the ends. Writes the full order, so from then on the file says exactly what
 * the panel shows. Returns false, writing nothing, if it could not move.
 */
export function moveWatchlistSymbol(symbol: string, by: number): boolean {
  const s = symbol.trim().toUpperCase();
  const { data } = readFile();
  const order = orderOf(data);
  const from = order.indexOf(s);
  if (from === -1) return false;
  const to = Math.max(0, Math.min(order.length - 1, from + by));
  if (to === from) return false;
  order.splice(from, 1);
  order.splice(to, 0, s);
  data.order = order;
  saveJsonConfig("watchlist.json", data);
  return true;
}
