import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COMMANDS, preApprovableCommands } from "./registry";
import { REPO_ROOT } from "../core/paths";

// The allowlist is a second description of the command surface, and second
// descriptions drift. These tests hold it against registry.ts, which is the
// first one — so adding a command with `writes: true` and forgetting the
// allowlist fails here rather than in somebody's session.

interface Settings {
  permissions: { allow: string[]; deny: string[] };
}

const settings = JSON.parse(
  readFileSync(join(REPO_ROOT, ".claude", "settings.json"), "utf8"),
) as Settings;

const allow = settings.permissions.allow.join("\n");
const deny = settings.permissions.deny.join("\n");

test("every pre-approvable command is allowlisted", () => {
  for (const command of preApprovableCommands()) {
    assert.ok(
      allow.includes(`toreda ${command.name}`),
      `${command.name} is read-only but not allowlisted — users will be prompted for it`,
    );
  }
});

test("interactive commands are not pre-approved", () => {
  // Safe, but an agent that runs one blocks until a human quits it. Note this
  // is per-subcommand: `schedule status` is allowlisted, `schedule install`
  // is not, because only one of them changes the machine.
  for (const command of COMMANDS.filter((c) => c.interactive)) {
    assert.ok(
      !allow.includes(`toreda ${command.name}:`),
      `${command.name} is interactive and should not be pre-approved`,
    );
  }
});

// THE test. `order` is the only command that can move money, and the entire
// safety model rests on a human seeing a prompt every single time.
test("the write command is never allowlisted", () => {
  const writers = COMMANDS.filter((c) => c.writes);
  assert.ok(writers.length > 0, "expected at least one write command");
  for (const command of writers) {
    assert.ok(
      !allow.includes(`toreda ${command.name}`),
      `${command.name} can change the account and must NOT be pre-approved`,
    );
  }
});

test("the write command is additionally denied, not merely omitted", () => {
  // Defence in depth: omission relies on nothing else granting it, whereas a
  // deny rule takes precedence over any allow — including a broad one a user
  // adds later to their own settings.
  for (const command of COMMANDS.filter((c) => c.writes)) {
    assert.ok(
      deny.includes(`toreda ${command.name}`),
      `${command.name} should be explicitly denied`,
    );
  }
});

test("every invocation form of order is denied", () => {
  // A rule covering only one spelling is not a rule.
  for (const form of ["toreda order", "npm run toreda -- order", "node bin/toreda.mjs order"]) {
    assert.ok(deny.includes(form), `missing deny rule for "${form}"`);
  }
});

test("the allowlist covers every invocation form of a read command", () => {
  for (const form of ["toreda portfolio", "npm run toreda -- portfolio", "node bin/toreda.mjs portfolio"]) {
    assert.ok(allow.includes(form), `missing allow rule for "${form}"`);
  }
});

test("secrets are denied for reading and editing", () => {
  assert.ok(deny.includes("Read(./.env)"), ".env must not be readable");
  assert.ok(deny.includes("Edit(./.env)"), ".env must not be editable");
});

test("no allow rule grants the whole toreda command surface", () => {
  // A blanket `Bash(toreda:*)` would swallow `order --confirm`.
  for (const rule of settings.permissions.allow) {
    assert.notEqual(rule, "Bash(toreda:*)");
    assert.notEqual(rule, "Bash(npm run toreda:*)");
    assert.ok(!/^Bash\(toreda:\*\)$/.test(rule), `over-broad rule: ${rule}`);
  }
});

test("journal is writable but config is not", () => {
  // Claude journals trades; changing a risk rule is the human's decision, made
  // deliberately, and should surface as a prompt.
  assert.ok(allow.includes("Edit(./journal/**)"));
  assert.ok(!allow.includes("Edit(./config/**)"));
});
