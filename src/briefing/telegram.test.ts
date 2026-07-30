import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { escapeHtml, getBotInfo, sendMessage, waitForChatId } from "./telegram";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function mockFetch(impl: (url: string) => Promise<Response>): void {
  globalThis.fetch = ((input: string | URL | Request) =>
    impl(String(input))) as unknown as typeof globalThis.fetch;
}

const json = (body: unknown): Promise<Response> =>
  Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

// ── HTML escaping ───────────────────────────────────────────────────────────

test("the three HTML-significant characters are escaped", () => {
  assert.equal(escapeHtml("a < b & c > d"), "a &lt; b &amp; c &gt; d");
});

// A company name containing & would otherwise break Telegram's HTML parser and
// the whole message would be rejected — losing the briefing, not just the name.
test("an ampersand in real content is escaped", () => {
  assert.equal(escapeHtml("Standard & Poor's"), "Standard &amp; Poor&#39;s".replace("&#39;", "'"));
});

test("escaping is order-safe: ampersands are not double-escaped", () => {
  assert.equal(escapeHtml("&lt;"), "&amp;lt;");
});

// ── Bot verification ────────────────────────────────────────────────────────

test("a valid token returns the bot identity", () => {
  mockFetch(() => json({ ok: true, result: { username: "my_bot", first_name: "My Bot" } }));
  return getBotInfo("token").then((info) => {
    assert.equal(info?.username, "my_bot");
    assert.equal(info?.name, "My Bot");
  });
});

test("an invalid token returns null rather than throwing", async () => {
  mockFetch(() => Promise.resolve(new Response("Unauthorized", { status: 401 })));
  assert.equal(await getBotInfo("bad"), null);
});

test("a network failure during verification returns null", async () => {
  mockFetch(() => Promise.reject(new Error("ENOTFOUND")));
  assert.equal(await getBotInfo("token"), null);
});

// ── Sending ─────────────────────────────────────────────────────────────────

test("a refused send reports Telegram's own reason", async () => {
  mockFetch(() => json({ ok: false, description: "chat not found" }));
  const res = await sendMessage({ botToken: "t", chatId: "1" }, "hi");
  assert.equal(res.ok, false);
  assert.equal(res.error, "chat not found");
});

test("a network failure during send is reported, not thrown", async () => {
  mockFetch(() => Promise.reject(new Error("socket hang up")));
  const res = await sendMessage({ botToken: "t", chatId: "1" }, "hi");
  assert.equal(res.ok, false);
  assert.match(res.error ?? "", /socket hang up/);
});

// ── Chat-ID detection ───────────────────────────────────────────────────────
// The step that strands people. The manual alternative is opening a getUpdates
// URL and hand-parsing JSON for an id nested three levels down.

test("a message to the bot yields its chat id", async () => {
  let call = 0;
  mockFetch(() => {
    call++;
    // First call drains existing updates; the second carries the new message.
    if (call === 1) return json({ ok: true, result: [] });
    return json({ ok: true, result: [{ update_id: 5, message: { chat: { id: 987654 } } }] });
  });
  const id = await waitForChatId("token", { timeoutMs: 5_000, pollMs: 10 });
  assert.equal(id, "987654");
});

test("a numeric chat id is returned as a string, preserving negatives", async () => {
  let call = 0;
  mockFetch(() => {
    call++;
    if (call === 1) return json({ ok: true, result: [] });
    // Group chats have negative ids; coercing through a number must not lose it.
    return json({ ok: true, result: [{ update_id: 1, message: { chat: { id: -1001234567890 } } }] });
  });
  const id = await waitForChatId("token", { timeoutMs: 5_000, pollMs: 10 });
  assert.equal(id, "-1001234567890");
});

test("timing out returns null instead of throwing, so setup can offer manual entry", async () => {
  mockFetch(() => json({ ok: true, result: [] }));
  const id = await waitForChatId("token", { timeoutMs: 120, pollMs: 20 });
  assert.equal(id, null);
});

test("transient poll failures do not abort the wait", async () => {
  let call = 0;
  mockFetch(() => {
    call++;
    if (call === 1) return json({ ok: true, result: [] });
    if (call < 4) return Promise.reject(new Error("blip"));
    return json({ ok: true, result: [{ update_id: 9, message: { chat: { id: 42 } } }] });
  });
  const id = await waitForChatId("token", { timeoutMs: 5_000, pollMs: 10 });
  assert.equal(id, "42");
});

// A message sent before setup began should not resolve instantly with a chat
// the user did not just choose — the prompt says "send one now".
test("updates queued before the wait started are drained first", async () => {
  let call = 0;
  const seenUrls: string[] = [];
  mockFetch((url) => {
    seenUrls.push(url);
    call++;
    if (call === 1) return json({ ok: true, result: [{ update_id: 100 }] });
    return json({ ok: true, result: [] });
  });
  await waitForChatId("token", { timeoutMs: 60, pollMs: 20 });
  // The polling call must ask for updates AFTER the drained id.
  assert.ok(
    seenUrls.slice(1).some((u) => u.includes("offset=101")),
    `expected offset=101, saw ${seenUrls.slice(1).join(", ")}`,
  );
});

test("an abort signal stops the wait early", async () => {
  mockFetch(() => json({ ok: true, result: [] }));
  const signal = { aborted: true };
  assert.equal(await waitForChatId("token", { timeoutMs: 5_000, pollMs: 10, signal }), null);
});
