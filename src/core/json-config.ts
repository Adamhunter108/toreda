// Shared loader for the JSON config files (risk, scanner, ui, watchlist).
//
// The source project repeated this shape four times, each with its own walk-up
// loop and its own slightly different defensive-load behaviour. The lookup now
// lives in paths.ts and the merge behaviour lives here, so a new config file is
// a type plus a defaults object rather than another copy of the machinery.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { configFile, defaultConfigFile } from "./paths";

/**
 * Read a config file, falling back through the user's copy, the shipped
 * default, and finally the built-in constant.
 *
 * A malformed or hand-edited file must never take the tool down: a trader
 * mid-session needs their positions more than they need to be told their JSON
 * has a trailing comma. Errors are returned rather than thrown so a caller
 * (doctor, mainly) can surface them at a sensible moment.
 */
export interface LoadResult<T> {
  value: T;
  /** Which source won: the user's file, the shipped default, or the constant. */
  source: "user" | "default" | "builtin";
  /** Set when a file existed but could not be used. */
  error?: string;
}

function readJson(path: string): { ok: true; data: unknown } | { ok: false; error: string } {
  try {
    if (!existsSync(path)) return { ok: false, error: "" };
    return { ok: true, data: JSON.parse(readFileSync(path, "utf8")) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function loadJsonConfig<T>(
  name: string,
  builtin: T,
  merge: (raw: Record<string, unknown>, defaults: T) => T,
): LoadResult<T> {
  const user = readJson(configFile(name));
  if (user.ok) {
    return {
      value: merge(user.data as Record<string, unknown>, builtin),
      source: "user",
    };
  }

  const shipped = readJson(defaultConfigFile(name));
  if (shipped.ok) {
    return {
      value: merge(shipped.data as Record<string, unknown>, builtin),
      source: "default",
      ...(user.error ? { error: `${configFile(name)}: ${user.error}` } : {}),
    };
  }

  return {
    value: builtin,
    source: "builtin",
    ...(user.error ? { error: `${configFile(name)}: ${user.error}` } : {}),
  };
}

/** Write a config file, creating config/ if this is the first write. */
export function saveJsonConfig(name: string, value: unknown): void {
  const path = configFile(name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

/** Numeric field with a default, ignoring nulls and non-numbers. */
export function pickNumber(raw: Record<string, unknown>, key: string, fallback: number): number {
  const v = raw[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export function pickBoolean(raw: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const v = raw[key];
  return typeof v === "boolean" ? v : fallback;
}

export function pickStringArray(raw: Record<string, unknown>, key: string, fallback: string[]): string[] {
  const v = raw[key];
  return Array.isArray(v) && v.every((x) => typeof x === "string") ? v : fallback;
}

/** A nested object field, as a plain record. Empty when absent or wrong-typed. */
export function pickObject(raw: Record<string, unknown>, key: string): Record<string, unknown> {
  const v = raw[key];
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
