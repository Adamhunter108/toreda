import { test } from "node:test";
import assert from "node:assert/strict";
import {
  briefCommand,
  cronLine,
  launchdPlist,
  schtasksArgs,
  schtasksName,
  systemdService,
  systemdTimer,
  type Job,
} from "./backends";
import { homedir } from "node:os";
import { REPO_ROOT } from "../core/paths";

const OPEN: Job = { kind: "open", at: { hour: 14, minute: 30 } };
const CLOSE: Job = { kind: "close", at: { hour: 21, minute: 5 } };

// A scheduler file with an absolute home directory or a personal label baked
// into it works in exactly one checkout. Everything generated here has to come
// from the paths THIS clone occupies.
test("the scheduled command points at this checkout, not a hard-coded path", () => {
  const { program, args } = briefCommand("open");
  assert.equal(program, process.execPath);
  assert.ok(args[0]?.startsWith(REPO_ROOT), `${args[0]} is outside ${REPO_ROOT}`);
  assert.ok(args.includes("brief"));
  assert.ok(args.includes("open"));
});

test("no generated artifact contains a hard-coded personal path or label", () => {
  const artifacts = [
    launchdPlist(OPEN),
    systemdService(OPEN),
    systemdTimer(OPEN),
    cronLine(OPEN),
    schtasksArgs(OPEN).join(" "),
  ];
  for (const text of artifacts) {
    // Positive assertion: labels must be toreda's own namespace, rather than a
    // blocklist of names somebody once used.
    const labels = text.match(/com\.[a-z.]+/g) ?? [];
    for (const label of labels) {
      assert.ok(label.startsWith("com.toreda."), `unexpected label namespace: ${label}`);
    }
    // Every absolute path must be DERIVED from this machine — the repo root, the
    // home directory, or the running node binary — rather than baked in. Strip
    // all occurrences of each (replaceAll: the plist references the repo four
    // times) and nothing user-specific should remain.
    const stripped = text
      .split(REPO_ROOT)
      .join("<repo>")
      .split(homedir())
      .join("<home>")
      .split(process.execPath)
      .join("<node>");
    assert.ok(
      !/\/(Users|home)\/[a-z]/i.test(stripped),
      `leaked a personal path: ${/\/(Users|home)\/\S+/i.exec(stripped)?.[0]}`,
    );
  }
});

test("generated artifacts are actually rooted in this checkout", () => {
  // The flip side of the test above: derived-from-here is only meaningful if
  // the paths are present at all.
  assert.ok(launchdPlist(OPEN).includes(REPO_ROOT));
  assert.ok(systemdService(OPEN).includes(REPO_ROOT));
  assert.ok(cronLine(OPEN).includes(REPO_ROOT));
});

// ── launchd ─────────────────────────────────────────────────────────────────

test("the launchd plist fires on weekdays only at the given local time", () => {
  const plist = launchdPlist(OPEN);
  for (const weekday of [1, 2, 3, 4, 5]) {
    assert.ok(plist.includes(`<integer>${weekday}</integer>`), `missing weekday ${weekday}`);
  }
  assert.ok(plist.includes("<key>Hour</key><integer>14</integer>"));
  assert.ok(plist.includes("<key>Minute</key><integer>30</integer>"));
});

test("the launchd plist does not run at load", () => {
  // RunAtLoad would fire a briefing the moment it is installed, at whatever
  // time that happens to be — usually mid-afternoon, reporting stale prices.
  assert.match(launchdPlist(OPEN), /<key>RunAtLoad<\/key>\s*<false\/>/);
});

test("the launchd plist is well-formed XML with a single root", () => {
  const plist = launchdPlist(CLOSE);
  assert.ok(plist.startsWith("<?xml"));
  assert.equal((plist.match(/<plist/g) ?? []).length, 1);
  assert.equal((plist.match(/<\/plist>/g) ?? []).length, 1);
  // Every opened dict is closed.
  assert.equal((plist.match(/<dict>/g) ?? []).length, (plist.match(/<\/dict>/g) ?? []).length);
});

test("each briefing kind gets its own label", () => {
  assert.notEqual(launchdPlist(OPEN), launchdPlist(CLOSE));
  assert.ok(launchdPlist(OPEN).includes("com.toreda.briefing-open"));
  assert.ok(launchdPlist(CLOSE).includes("com.toreda.briefing-close"));
});

// ── systemd ─────────────────────────────────────────────────────────────────

test("the systemd timer uses a weekday OnCalendar with zero-padded time", () => {
  const timer = systemdTimer(CLOSE);
  assert.match(timer, /OnCalendar=Mon\.\.Fri \*-\*-\* 21:05:00/);
});

test("a single-digit hour is still zero-padded for systemd", () => {
  // "6:30:00" is not valid OnCalendar syntax; "06:30:00" is.
  const timer = systemdTimer({ kind: "open", at: { hour: 6, minute: 30 } });
  assert.match(timer, /06:30:00/);
});

test("the systemd service is a oneshot rooted in the repo", () => {
  const service = systemdService(OPEN);
  assert.match(service, /Type=oneshot/);
  assert.ok(service.includes(`WorkingDirectory=${REPO_ROOT}`));
});

// ── cron ────────────────────────────────────────────────────────────────────

test("the cron line puts minute and hour in the right fields, weekdays only", () => {
  const line = cronLine(OPEN);
  assert.ok(line.startsWith("30 14 * * 1-5 "), line);
});

test("the cron line is tagged so it can be found again", () => {
  assert.match(cronLine(CLOSE), /# com\.toreda\.briefing-close$/);
});

// ── schtasks ────────────────────────────────────────────────────────────────

test("schtasks gets weekday flags and a zero-padded start time", () => {
  const args = schtasksArgs(OPEN);
  assert.ok(args.includes("MON,TUE,WED,THU,FRI"));
  const startIdx = args.indexOf("/ST");
  assert.equal(args[startIdx + 1], "14:30");
});

test("schtasks task names are distinct per kind", () => {
  assert.notEqual(schtasksName("open"), schtasksName("close"));
});

test("schtasks quotes the program path, which contains spaces on Windows", () => {
  const args = schtasksArgs(OPEN);
  const runIdx = args.indexOf("/TR");
  assert.ok(args[runIdx + 1]?.startsWith('"'), "program path must be quoted");
});
