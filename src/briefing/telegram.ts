// Telegram delivery. Entirely optional — `toreda brief` prints to the terminal
// with none of this configured.

import { getJson, postJson } from "../core/http";

const API = "https://api.telegram.org";

export interface TelegramCredentials {
  botToken: string;
  chatId: string;
}

interface SendResult {
  ok: boolean;
  error?: string;
}

/** Escape the five characters Telegram's HTML parse mode cares about. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function sendMessage(
  creds: TelegramCredentials,
  text: string,
  options: { html?: boolean } = {},
): Promise<SendResult> {
  try {
    const body: Record<string, unknown> = {
      chat_id: creds.chatId,
      text,
      disable_web_page_preview: true,
    };
    if (options.html) body.parse_mode = "HTML";

    const res = await postJson<{ ok?: boolean; description?: string }>(
      `${API}/bot${creds.botToken}/sendMessage`,
      body,
      { timeoutMs: 20_000 },
    );
    return res.ok ? { ok: true } : { ok: false, error: res.description ?? "Telegram refused it" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface BotInfo {
  username: string;
  name: string;
}

/** Verify a bot token and return who it belongs to. Null when the token is bad. */
export async function getBotInfo(botToken: string): Promise<BotInfo | null> {
  try {
    const res = await getJson<{
      ok?: boolean;
      result?: { username?: string; first_name?: string };
    }>(`${API}/bot${botToken}/getMe`, { retries: 1, timeoutMs: 15_000 });
    if (!res.ok || !res.result?.username) return null;
    return {
      username: res.result.username,
      name: res.result.first_name ?? res.result.username,
    };
  } catch {
    return null;
  }
}

/**
 * Find the chat ID by watching for a message sent to the bot.
 *
 * This is the step that strands people. The manual alternative is: message your
 * bot, open a getUpdates URL in a browser, and hand-parse JSON for a numeric id
 * nested three levels down. Polling for it turns the worst part of Telegram
 * setup into "send your bot a message", which needs no explanation at all.
 *
 * Returns null on timeout rather than throwing, so the caller can offer to
 * enter the ID manually instead of failing the whole flow.
 */
export async function waitForChatId(
  botToken: string,
  options: {
    timeoutMs?: number;
    pollMs?: number;
    onPoll?: (elapsedMs: number) => void;
    signal?: { aborted: boolean };
  } = {},
): Promise<string | null> {
  const timeout = options.timeoutMs ?? 120_000;
  const interval = options.pollMs ?? 2_000;
  const started = Date.now();

  // Clear anything already queued, so a message sent BEFORE setup started does
  // not resolve instantly with a stale chat — and so `offset` starts sane.
  let offset = await latestUpdateId(botToken);

  while (Date.now() - started < timeout) {
    if (options.signal?.aborted) return null;

    try {
      const res = await getJson<{
        ok?: boolean;
        result?: Array<{
          update_id?: number;
          message?: { chat?: { id?: number | string } };
        }>;
      }>(
        `${API}/bot${botToken}/getUpdates?timeout=0&offset=${offset + 1}`,
        { retries: 0, timeoutMs: 10_000 },
      );

      for (const update of res.result ?? []) {
        if (typeof update.update_id === "number") offset = update.update_id;
        const id = update.message?.chat?.id;
        if (id !== undefined && id !== null) return String(id);
      }
    } catch {
      // A transient failure mid-poll is not fatal; keep waiting.
    }

    options.onPoll?.(Date.now() - started);
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  return null;
}

/** The highest update_id currently queued, so polling can skip old messages. */
async function latestUpdateId(botToken: string): Promise<number> {
  try {
    const res = await getJson<{ result?: Array<{ update_id?: number }> }>(
      `${API}/bot${botToken}/getUpdates?timeout=0`,
      { retries: 0, timeoutMs: 10_000 },
    );
    const ids = (res.result ?? [])
      .map((u) => u.update_id)
      .filter((n): n is number => typeof n === "number");
    return ids.length > 0 ? Math.max(...ids) : 0;
  } catch {
    return 0;
  }
}
