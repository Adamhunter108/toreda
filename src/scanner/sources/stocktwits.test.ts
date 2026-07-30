import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  createTrendingCache,
  fetchSymbolStream,
  fetchTrending,
  SourceHealth,
} from "./stocktwits";

// StockTwits is an undocumented public API with no stability guarantee and no
// contract with us. For a tool shared with other people that is a liability, so
// the requirement is explicit: every failure mode DEGRADES the scan rather than
// killing it. These tests hold that line.

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function mockFetch(impl: () => Promise<Response> | Promise<never>): void {
  globalThis.fetch = impl as unknown as typeof globalThis.fetch;
}

function jsonResponse(body: unknown): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
}

test("a network failure yields no posts instead of throwing", async () => {
  mockFetch(() => Promise.reject(new Error("ENOTFOUND api.stocktwits.com")));
  const health = new SourceHealth();
  const posts = await fetchSymbolStream("NVDA", health);
  assert.deepEqual(posts, []);
  assert.equal(health.healthy, false);
  assert.match(health.degraded.join(" "), /unreachable/);
});

test("a rate-limit response yields no posts instead of throwing", async () => {
  mockFetch(() => Promise.resolve(new Response("rate limited", { status: 429 })));
  const health = new SourceHealth();
  assert.deepEqual(await fetchSymbolStream("NVDA", health), []);
  assert.equal(health.healthy, false);
});

test("an API-level error object is treated as a failure, not as zero posts", async () => {
  // A silent [] here would read as "the crowd said nothing", which is a
  // materially different claim from "we could not ask".
  mockFetch(() => jsonResponse({ errors: [{ message: "Symbol not found" }] }));
  const health = new SourceHealth();
  assert.deepEqual(await fetchSymbolStream("NVDA", health), []);
  assert.equal(health.healthy, false);
});

test("malformed JSON degrades rather than throwing", async () => {
  mockFetch(() => Promise.resolve(new Response("<html>502 Bad Gateway</html>", { status: 200 })));
  const health = new SourceHealth();
  assert.deepEqual(await fetchSymbolStream("NVDA", health), []);
  assert.equal(health.healthy, false);
});

test("trending degrades to an empty list", async () => {
  mockFetch(() => Promise.reject(new Error("socket hang up")));
  const health = new SourceHealth();
  assert.deepEqual(await fetchTrending(health), []);
  assert.match(health.degraded.join(" "), /trending unavailable/);
});

test("a healthy response parses posts and their author-declared sentiment", async () => {
  mockFetch(() =>
    jsonResponse({
      messages: [
        {
          body: "looks strong here",
          symbols: [{ symbol: "NVDA" }],
          entities: { sentiment: { basic: "Bullish" } },
        },
        {
          body: "no tag on this one",
          symbols: [{ symbol: "NVDA" }],
          entities: { sentiment: null },
        },
      ],
    }),
  );
  const health = new SourceHealth();
  const posts = await fetchSymbolStream("NVDA", health);
  assert.equal(posts.length, 2);
  assert.equal(posts[0]?.sentiment, "Bullish");
  // Untagged stays null so the scoring layer can skip it rather than guess.
  assert.equal(posts[1]?.sentiment, null);
  assert.equal(health.healthy, true);
});

test("an unexpected sentiment value is normalised to null, not trusted", async () => {
  mockFetch(() =>
    jsonResponse({
      messages: [
        {
          body: "x",
          symbols: [{ symbol: "NVDA" }],
          entities: { sentiment: { basic: "Enthusiastic" } },
        },
      ],
    }),
  );
  assert.equal((await fetchSymbolStream("NVDA", new SourceHealth()))[0]?.sentiment, null);
});

test("missing fields do not produce undefined posts", async () => {
  mockFetch(() => jsonResponse({ messages: [{}] }));
  const posts = await fetchSymbolStream("NVDA", new SourceHealth());
  assert.equal(posts[0]?.body, "");
  assert.deepEqual(posts[0]?.symbols, []);
});

test("health deduplicates repeated failures of the same kind", async () => {
  mockFetch(() => Promise.reject(new Error("ENOTFOUND api.stocktwits.com")));
  const health = new SourceHealth();
  await fetchSymbolStream("NVDA", health);
  await fetchSymbolStream("AMD", health);
  await fetchSymbolStream("AAPL", health);
  // Ten symbols failing the same way is one problem, reported once.
  assert.equal(health.degraded.length, 1);
});

test("the trending cache asks once per scan, even after a failure", async () => {
  let calls = 0;
  mockFetch(() => {
    calls++;
    return Promise.reject(new Error("down"));
  });
  const trending = createTrendingCache();
  const health = new SourceHealth();

  await trending(health);
  // Counted after the first call rather than hard-coded, so the assertion is
  // about caching and not about how many retries getJson happens to make.
  const afterFirst = calls;
  assert.ok(afterFirst > 0, "the first call must actually hit the network");

  await trending(health);
  await trending(health);

  // Caching on failure too: one bad run must not become three bad requests,
  // since both the signal path and the discovery path ask for this.
  assert.equal(calls, afterFirst, "subsequent calls must be served from cache");
});
