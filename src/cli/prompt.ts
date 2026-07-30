// Interactive prompts for the setup wizard.
//
// Dependency-free on purpose. A setup flow that handles API keys should not
// pull in a prompt library and its transitive tree — the blast radius of a
// compromised dependency here is somebody's brokerage account.

import { createInterface } from "node:readline/promises";
import { c } from "./format";

export class CancelledError extends Error {
  constructor(options?: { cause?: unknown }) {
    super("cancelled", options);
    this.name = "CancelledError";
  }
}

/** Setup needs a real terminal. Say so plainly rather than hanging on stdin. */
export function requireInteractive(): void {
  if (!process.stdin.isTTY) {
    throw new Error(
      "`toreda setup` needs an interactive terminal.\n" +
        "  If you are running this through a pipe or a CI job, copy .env.example\n" +
        "  to .env and fill it in by hand instead.",
    );
  }
}

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } catch (err) {
    // stdin closed mid-question — Ctrl+D, a hangup, or a script that ran out of
    // input. That is a cancellation, not a crash, and reporting it as an
    // internal error would suggest something is broken when nothing is.
    throw new CancelledError({ cause: err });
  } finally {
    rl.close();
  }
}

/** Free text with an optional default. */
export async function text(
  question: string,
  options: { default?: string; allowEmpty?: boolean } = {},
): Promise<string> {
  const suffix = options.default ? c.dim(` (${options.default})`) : "";
  for (;;) {
    const answer = await ask(`  ${question}${suffix}: `);
    if (answer) return answer;
    if (options.default !== undefined) return options.default;
    if (options.allowEmpty) return "";
    process.stdout.write(c.yellow("    A value is required.\n"));
  }
}

// Control characters, named. Written as escapes rather than literal bytes so
// they survive copy-paste, diffs, and editors that strip control characters.
const CTRL_C = "\u0003";
const CTRL_D = "\u0004";
const BACKSPACE = "\u007f";
const BACKSPACE_ALT = "\b";
const ESCAPE = "\u001b";

/**
 * Secret input, echoed as bullets.
 *
 * Hiding matters less for someone watching the screen than for what comes
 * after: scrollback, screen shares, and terminal recordings all keep whatever
 * was echoed.
 */
export async function secret(question: string): Promise<string> {
  process.stdout.write(`  ${question}: `);
  const stdin = process.stdin;

  return new Promise<string>((resolve, reject) => {
    let value = "";
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    const cleanup = (): void => {
      stdin.setRawMode(wasRaw ?? false);
      stdin.pause();
      stdin.removeListener("data", onData);
    };

    const onData = (chunk: string): void => {
      // A pasted key arrives as ONE multi-character chunk, so this iterates
      // rather than assuming a single keypress.
      for (const char of chunk) {
        if (char === "\r" || char === "\n" || char === CTRL_D) {
          cleanup();
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (char === CTRL_C) {
          cleanup();
          process.stdout.write("\n");
          reject(new CancelledError());
          return;
        }
        if (char === BACKSPACE || char === BACKSPACE_ALT) {
          if (value.length > 0) {
            value = value.slice(0, -1);
            process.stdout.write("\b \b");
          }
          continue;
        }
        // Printable characters only. Without this an arrow key's escape
        // sequence lands inside the API key and the failure appears later, as
        // an authentication error with no visible cause.
        if (char >= " " && char !== ESCAPE) {
          value += char;
          process.stdout.write("•");
        }
      }
    };

    stdin.on("data", onData);
  });
}

export async function confirm(question: string, defaultYes = false): Promise<boolean> {
  const hint = defaultYes ? "Y/n" : "y/N";
  for (;;) {
    const answer = (await ask(`  ${question} ${c.dim(`[${hint}]`)} `)).toLowerCase();
    if (!answer) return defaultYes;
    if (["y", "yes"].includes(answer)) return true;
    if (["n", "no"].includes(answer)) return false;
    process.stdout.write(c.yellow("    Please answer y or n.\n"));
  }
}

export interface Choice<T> {
  label: string;
  value: T;
  hint?: string;
}

/**
 * Numbered single-select.
 *
 * Numbered rather than arrow-driven so it behaves identically in every
 * terminal, including the ones that mangle raw-mode arrow keys — which is the
 * difference between a first-run experience that works and one that strands
 * somebody before they have a working install.
 */
export async function select<T>(
  question: string,
  choices: Choice<T>[],
  defaultIndex = 0,
): Promise<T> {
  process.stdout.write(`\n  ${question}\n\n`);
  choices.forEach((choice, i) => {
    const marker = i === defaultIndex ? c.cyan("›") : " ";
    const hint = choice.hint ? c.dim(`  ${choice.hint}`) : "";
    process.stdout.write(`  ${marker} ${c.bold(String(i + 1))}. ${choice.label}${hint}\n`);
  });
  process.stdout.write("\n");

  for (;;) {
    const answer = await ask(`  Choose 1-${choices.length} ${c.dim(`(${defaultIndex + 1})`)}: `);
    if (!answer) return choices[defaultIndex]!.value;
    const n = Number(answer);
    if (Number.isInteger(n) && n >= 1 && n <= choices.length) return choices[n - 1]!.value;
    process.stdout.write(c.yellow(`    Enter a number from 1 to ${choices.length}.\n`));
  }
}

/** A number within bounds, re-asking until valid. */
export async function number(
  question: string,
  options: { default: number; min?: number; max?: number; suffix?: string },
): Promise<number> {
  const { min = -Infinity, max = Infinity } = options;
  for (;;) {
    const raw = await text(question, { default: String(options.default) });
    const value = Number(raw);
    if (Number.isFinite(value) && value >= min && value <= max) return value;
    process.stdout.write(
      c.yellow(`    Enter a number between ${min} and ${max}${options.suffix ?? ""}.\n`),
    );
  }
}

// ── Presentation ────────────────────────────────────────────────────────────

export function step(current: number, total: number, title: string): void {
  process.stdout.write(`\n${c.dim(`Step ${current}/${total}`)}  ${c.bold(title)}\n`);
}

export function say(...lines: string[]): void {
  for (const line of lines) process.stdout.write(`  ${line}\n`);
}

export function rule(): void {
  process.stdout.write(c.dim(`  ${"─".repeat(60)}\n`));
}
