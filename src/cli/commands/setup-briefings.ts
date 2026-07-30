// `toreda setup briefings` — the guided, optional briefing setup.
//
// Kept out of the core wizard on purpose. Creating a Telegram bot is the single
// most abandonable step in any setup here, and putting it between a new user and
// a working install is how people give up halfway.

import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseEnvFile } from "../../core/config";
import { envFile } from "../../core/paths";
import { getBotInfo, sendMessage, waitForChatId } from "../../briefing/telegram";
import { c, out } from "../format";
import { CancelledError, confirm, rule, say, secret, select, text } from "../prompt";

/** Update individual keys in .env, leaving everything else untouched. */
function updateEnv(updates: Record<string, string>): void {
  const path = envFile();
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  let output = existing;

  for (const [key, value] of Object.entries(updates)) {
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^${key}=.*$`, "m");
    output = pattern.test(output) ? output.replace(pattern, line) : `${output.trimEnd()}\n${line}\n`;
  }

  writeFileSync(path, output);
  if (process.platform !== "win32") chmodSync(path, 0o600);
}

async function configureTelegram(): Promise<boolean> {
  say(
    "",
    c.bold("Setting up Telegram"),
    "",
    "  1. Open Telegram and message " + c.cyan("@BotFather"),
    "  2. Send " + c.bold("/newbot") + " and follow the prompts",
    "  3. It replies with a token that looks like " + c.dim("123456789:AAE...xyz"),
    "",
  );

  let botToken = "";
  let botUsername = "";
  for (;;) {
    botToken = await secret("Paste the bot token");
    out(c.dim("    checking with Telegram…"));
    const info = await getBotInfo(botToken);
    if (info) {
      botUsername = info.username;
      out(`    ${c.green("✓")} Connected to ${c.bold("@" + info.username)}`);
      break;
    }
    out(`    ${c.red("✗")} Telegram did not recognise that token.`);
    if (!(await confirm("Try again?", true))) return false;
  }

  // The step that strands people. Rather than "open a getUpdates URL and find
  // the numeric id nested three levels into the JSON", just watch for a message.
  say(
    "",
    c.bold("Now tell the bot who you are"),
    "",
    `  Open Telegram, find ${c.cyan("@" + botUsername)}, and send it any message.`,
    c.dim("  (Just say hi — I'm watching for it.)"),
    "",
  );

  let chatId = await waitForChatId(botToken, {
    timeoutMs: 120_000,
    onPoll: (elapsed) => {
      if (elapsed > 0 && elapsed % 20_000 < 2_100) {
        out(c.dim(`    still waiting… (${Math.round(elapsed / 1000)}s)`));
      }
    },
  });

  if (!chatId) {
    out("", `  ${c.yellow("⚠")} No message arrived within two minutes.`);
    if (await confirm("Enter the chat ID manually instead?", false)) {
      chatId = await text("Chat ID");
    } else {
      return false;
    }
  } else {
    out(`    ${c.green("✓")} Got it — chat ${c.bold(chatId)}`);
  }

  updateEnv({ TELEGRAM_BOT_TOKEN: botToken, TELEGRAM_CHAT_ID: chatId });

  // Prove it works rather than asserting it. A test message is the difference
  // between "configured" and "actually delivers".
  out("", c.dim("    sending a test message…"));
  const result = await sendMessage(
    { botToken, chatId },
    "✅ toreda is connected. Your market briefings will arrive here.",
  );
  if (result.ok) {
    out(`    ${c.green("✓")} Sent — check Telegram.`);
    return true;
  }
  out(`    ${c.red("✗")} Could not send: ${result.error}`);
  out(c.dim("      Credentials were saved; try `npm run toreda -- brief --telegram` to retry."));
  return false;
}

async function configureCommentary(): Promise<void> {
  const env = existsSync(envFile()) ? parseEnvFile(readFileSync(envFile(), "utf8")) : {};
  if (env.CLAUDE_CODE_OAUTH_TOKEN?.startsWith("sk-ant")) {
    out("", `  ${c.green("✓")} Claude commentary is already configured.`);
    return;
  }

  say(
    "",
    c.bold("Written commentary (optional)"),
    "",
    "  Briefings can include a few lines of written analysis alongside the",
    "  numbers. This uses your Claude Code subscription, not API billing.",
    "",
    "  Generate a token by running " + c.cyan("claude setup-token") + " in another",
    "  terminal, then paste it here. Skip this and briefings still send —",
    "  they just carry the numbers alone.",
    "",
  );

  const token = await secret("Paste the token (or press Enter to skip)");
  if (!token.trim()) {
    out(c.dim("    Skipped — briefings will send data without commentary."));
    return;
  }
  if (!token.startsWith("sk-ant")) {
    out(`    ${c.yellow("⚠")} That does not look like a Claude token; saving it anyway.`);
  }
  updateEnv({ CLAUDE_CODE_OAUTH_TOKEN: token });
  out(`    ${c.green("✓")} Saved.`);
}

export async function runBriefingSetup(): Promise<number> {
  out("");
  rule();
  out(`  ${c.bold("Briefing setup")}`);
  say(c.dim("Optional. toreda works fully without any of this."));
  rule();

  if (!existsSync(envFile())) {
    out(
      "",
      `  ${c.red("✗")} No configuration found. Run \`npm run setup\` first.`,
      "",
    );
    return 1;
  }

  const channel = await select<string>(
    "How would you like briefings delivered?",
    [
      { label: "Telegram", value: "telegram", hint: "a message on your phone" },
      {
        label: "Just my terminal",
        value: "terminal",
        hint: "run `toreda brief` when you want one",
      },
      { label: "A log file", value: "file", hint: "`toreda brief --out FILE`" },
    ],
    0,
  );

  if (channel === "telegram") {
    const ok = await configureTelegram();
    if (ok) await configureCommentary();
  } else if (channel === "file") {
    say(
      "",
      "  Nothing to configure — pass the path when you run it:",
      `    ${c.cyan("npm run toreda -- brief --out journal/briefings.log")}`,
    );
    await configureCommentary();
  } else {
    say("", "  Nothing to configure — just run:", `    ${c.cyan("npm run toreda -- brief")}`);
    await configureCommentary();
  }

  say(
    "",
    c.bold("Want these on a schedule?"),
    `  ${c.cyan("npm run toreda -- schedule install")}`,
    c.dim("  Installs weekday market-open and market-close runs, converted to your"),
    c.dim("  local time. Remove them any time with `schedule uninstall`."),
    "",
  );
  return 0;
}

export async function run(): Promise<number> {
  try {
    return await runBriefingSetup();
  } catch (err) {
    if (err instanceof CancelledError) {
      out("", c.yellow("  Cancelled — nothing was changed."), "");
      return 130;
    }
    throw err;
  }
}
