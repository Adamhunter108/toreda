import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import {
  REPO_ROOT,
  configFile,
  dataHome,
  defaultConfigFile,
  envFile,
  journalFileFor,
} from "./paths";

test("the repo root is the directory holding toreda's package.json", () => {
  assert.ok(isAbsolute(REPO_ROOT));
  assert.ok(existsSync(join(REPO_ROOT, "package.json")));
  assert.ok(existsSync(join(REPO_ROOT, "src", "core", "paths.ts")));
});

// The bug this module exists to fix. The source project walked up from
// process.cwd() and claimed to be cwd-independent; it was not. Resolving from
// this file's own URL genuinely is.
test("resolution does not depend on the working directory", () => {
  const original = process.cwd();
  try {
    process.chdir("/");
    assert.ok(existsSync(join(REPO_ROOT, "package.json")));
    assert.equal(dataHome(), REPO_ROOT);
  } finally {
    process.chdir(original);
  }
});

test("TOREDA_HOME redirects user data but not shipped defaults", () => {
  const original = process.env.TOREDA_HOME;
  // Expected values are BUILT with join() rather than written as literals.
  // Hardcoding "/tmp/x/.env" asserts a POSIX separator, which is a claim about
  // the test's own platform rather than about the code — and it fails on
  // Windows, where join correctly produces \tmp\x\.env.
  const home = join(tmpdir(), "toreda-test-home");
  try {
    process.env.TOREDA_HOME = home;
    assert.equal(dataHome(), home);
    assert.equal(envFile(), join(home, ".env"));
    assert.equal(configFile("risk.json"), join(home, "config", "risk.json"));
    // Defaults ship with the code and must keep coming from the repo, so a
    // `git pull` still updates them.
    assert.equal(defaultConfigFile("risk.json"), join(REPO_ROOT, "config", "risk.default.json"));
  } finally {
    if (original === undefined) delete process.env.TOREDA_HOME;
    else process.env.TOREDA_HOME = original;
  }
});

test("a relative TOREDA_HOME resolves against the working directory", () => {
  const original = process.env.TOREDA_HOME;
  try {
    process.env.TOREDA_HOME = "some-dir";
    assert.equal(dataHome(), join(process.cwd(), "some-dir"));
  } finally {
    if (original === undefined) delete process.env.TOREDA_HOME;
    else process.env.TOREDA_HOME = original;
  }
});

test("an empty TOREDA_HOME is ignored rather than resolving to nothing", () => {
  const original = process.env.TOREDA_HOME;
  try {
    process.env.TOREDA_HOME = "   ";
    assert.equal(dataHome(), REPO_ROOT);
  } finally {
    if (original === undefined) delete process.env.TOREDA_HOME;
    else process.env.TOREDA_HOME = original;
  }
});

test("default config filenames get the .default infix", () => {
  assert.ok(defaultConfigFile("scanner.json").endsWith("scanner.default.json"));
  assert.ok(defaultConfigFile("watchlist.json").endsWith("watchlist.default.json"));
});

test("journal files are named by year and month, zero-padded", () => {
  assert.ok(journalFileFor(new Date("2026-07-15T12:00:00Z")).endsWith("2026-07.md"));
  assert.ok(journalFileFor(new Date("2026-12-01T12:00:00Z")).endsWith("2026-12.md"));
});

test("every shipped default config file exists", () => {
  for (const name of ["risk.json", "scanner.json", "ui.json", "watchlist.json"]) {
    assert.ok(existsSync(defaultConfigFile(name)), `missing default for ${name}`);
  }
});
