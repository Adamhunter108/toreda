import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveJsonConfig } from "./json-config";
import { configFile } from "./paths";
import {
  addWatchlistSymbol,
  loadWatchlist,
  moveWatchlistSymbol,
  removeWatchlistSymbol,
  type WatchlistFile,
} from "./watchlist";

// Each test writes its own config/watchlist.json into a throwaway data home,
// so nothing here reads or touches a real watchlist.
let home = "";
let previous: string | undefined;
before(() => {
  previous = process.env.TOREDA_HOME;
  home = mkdtempSync(join(tmpdir(), "toreda-watchlist-"));
  process.env.TOREDA_HOME = home;
});
after(() => {
  if (previous === undefined) delete process.env.TOREDA_HOME;
  else process.env.TOREDA_HOME = previous;
  rmSync(home, { recursive: true, force: true });
});

const FILE: WatchlistFile = {
  _comment: ["kept across edits"],
  sectors: { Tech: ["CCC", "AAA"], Energy: ["EEE", "BBB"] },
};
beforeEach(() => saveJsonConfig("watchlist.json", FILE));

const onDisk = (): WatchlistFile =>
  JSON.parse(readFileSync(configFile("watchlist.json"), "utf8")) as WatchlistFile;

test("with no order set, your order is the file's own, sector by sector", () => {
  const wl = loadWatchlist();
  assert.deepEqual(wl.ordered, ["CCC", "AAA", "EEE", "BBB"]);
  assert.deepEqual(wl.symbols, ["AAA", "BBB", "CCC", "EEE"], "symbols stay alphabetical");
});

test("moving a symbol writes the whole order and leaves sectors alone", () => {
  assert.equal(moveWatchlistSymbol("bbb", -2), true);
  assert.deepEqual(loadWatchlist().ordered, ["CCC", "BBB", "AAA", "EEE"]);
  const file = onDisk();
  assert.deepEqual(file.order, ["CCC", "BBB", "AAA", "EEE"]);
  assert.deepEqual(file.sectors, FILE.sectors);
  assert.deepEqual(file._comment, FILE._comment);
});

test("a move past either end clamps, and a move that goes nowhere writes nothing", () => {
  assert.equal(moveWatchlistSymbol("EEE", -10), true);
  assert.deepEqual(loadWatchlist().ordered, ["EEE", "CCC", "AAA", "BBB"]);
  assert.equal(moveWatchlistSymbol("EEE", -1), false, "already first");
  assert.equal(moveWatchlistSymbol("ZZZ", 1), false, "not on the list");
});

test("adding and removing keep your order", () => {
  moveWatchlistSymbol("BBB", -3);
  assert.equal(addWatchlistSymbol("DDD"), true);
  assert.deepEqual(loadWatchlist().ordered, ["BBB", "CCC", "AAA", "EEE", "DDD"], "new names go last");
  assert.equal(removeWatchlistSymbol("AAA"), true);
  assert.deepEqual(loadWatchlist().ordered, ["BBB", "CCC", "EEE", "DDD"]);
  assert.ok(!onDisk().order?.includes("AAA"), "a removed name leaves the order too");
});

test("names in the order that are no longer tracked are skipped", () => {
  saveJsonConfig("watchlist.json", { ...FILE, order: ["zzz", "eee", "EEE", "aaa"] });
  assert.deepEqual(loadWatchlist().ordered, ["EEE", "AAA", "CCC", "BBB"]);
});
