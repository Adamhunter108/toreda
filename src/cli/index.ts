// `toreda` entry point: parse, dispatch, and translate failures into an exit
// code and a message a human can act on.
import { parseArgs, hasFlag } from "./args";
import { COMMANDS, findCommand, type CommandGroup } from "./registry";

const GROUP_ORDER: readonly CommandGroup[] = ["Account", "Analysis", "Trading", "Setup"];

function helpText(): string {
  const lines: string[] = [
    "",
    "  toreda — a Claude-driven Alpaca trading toolkit",
    "",
    "  Usage: toreda <command> [options]",
    "",
  ];
  const width = Math.max(...COMMANDS.map((c) => c.name.length));
  for (const group of GROUP_ORDER) {
    const inGroup = COMMANDS.filter((c) => c.group === group);
    if (inGroup.length === 0) continue;
    lines.push(`  ${group}`);
    for (const c of inGroup) {
      const mark = c.writes ? " *" : "  ";
      lines.push(`    ${c.name.padEnd(width)}${mark}  ${c.summary}`);
    }
    lines.push("");
  }
  lines.push("  * can change your account. Everything else is read-only.");
  lines.push("");
  lines.push("  New here?  npm run setup      Then:  toreda doctor");
  lines.push("");
  return lines.join("\n");
}

async function main(argv: readonly string[]): Promise<number> {
  // `--demo` anywhere on the line. Set as an env var rather than threaded
  // through every call, and set HERE so it is in place before any module reads
  // it. A shell prefix (`TOREDA_DEMO=1 cmd`) would not work on Windows.
  if (argv.includes("--demo")) process.env.TOREDA_DEMO = "1";

  // Parse once without value-flag knowledge to find the command, then re-parse
  // with that command's own flag spec. A single pass can't do this: which flags
  // take values depends on which command was named.
  const first = parseArgs(argv);

  // Version first: `toreda --version` must not fall through to help. `-v` is
  // only version when no command was named, leaving it free to mean "verbose"
  // on commands that want it.
  if (hasFlag(first, "version") || (first.command === null && hasFlag(first, "v"))) {
    process.stdout.write("toreda 0.1.0\n");
    return 0;
  }

  if (first.command === null) {
    // A bare `toreda` or `toreda --help` is a successful request for help, not
    // a usage error, so it goes to stdout and exits 0. An unknown command goes
    // to stderr and exits 1.
    process.stdout.write(helpText());
    return 0;
  }

  const cmd = findCommand(first.command);
  if (!cmd) {
    process.stderr.write(`\n  Unknown command: ${first.command}\n${helpText()}`);
    return 1;
  }

  if (hasFlag(first, "help", "h")) {
    process.stdout.write(`\n  ${cmd.summary}\n\n  ${cmd.usage}\n\n`);
    return 0;
  }

  if (!cmd.load) {
    process.stderr.write(
      `\n  \`toreda ${cmd.name}\` is not wired up yet in this build.\n` +
        `  Usage will be: ${cmd.usage}\n\n`,
    );
    return 1;
  }

  const mod = await cmd.load();
  // Re-parse now that we know which flags this command treats as taking a
  // value. Commands get both positionals and flags — `order` in particular
  // needs to see --confirm, and a positionals-only contract would silently
  // drop it, turning a confirmed order into a preview.
  const parsed = parseArgs(argv, { valueFlags: cmd.valueFlags });
  const code = await mod.run(parsed);
  return typeof code === "number" ? code : 0;
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`\n  ✗ ${msg}\n\n`);
    process.exitCode = 1;
  });
