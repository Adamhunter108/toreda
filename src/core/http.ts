// HTTP for Alpaca, with the read/write asymmetry built into the type system
// rather than left to discipline.
//
// The bash layer got this right and said why, in bin/_common.sh:
//
//     acurl is deliberately NOT retried: this is the helper order.sh POSTs
//     through, and a retried submission can fill twice. curl cannot tell "the
//     request never landed" from "the reply got lost on the way back", so a
//     retry on a mutation is a coin-flip on a duplicate order. A bounded hang
//     is recoverable; a double fill is not.
//
// The TypeScript layer had the same rule but only as a comment on one function.
// Here it is structural: `getJson` retries because retrying a GET is free, and
// `postJson` has no retry option to pass. You cannot accidentally retry a
// mutation, because there is no argument that would let you.
//
// The other half is the empty-body case. A hung request once returned an empty
// body, which parsed into nothing, which rendered as a briefing announcing a
// flat account while positions were open. An empty body is a failure and must
// throw — never resolve to `{}` or `[]`.

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export interface RequestOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface GetOptions extends RequestOptions {
  /** Extra attempts after the first. Retrying a GET is free. */
  retries?: number;
  retryDelayMs?: number;
}

const DEFAULT_TIMEOUT_MS = 20_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 5xx and 429 are worth retrying; a 4xx will fail identically every time. */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

async function request(
  method: "GET" | "POST" | "DELETE",
  url: string,
  opts: RequestOptions,
  body?: string,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      headers: opts.headers,
      body,
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new HttpError(
        `${method} ${redact(url)} failed: ${res.status} ${text.slice(0, 200)}`,
        res.status,
        text,
      );
    }
    return text;
  } catch (err) {
    // AbortError's default message ("This operation was aborted") tells a user
    // nothing about what to do. Say what timed out and for how long.
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(
        `${method} ${redact(url)} timed out after ${opts.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms — network down?`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function parse<T>(text: string, url: string): T {
  // The empty-body failure mode. An empty body is not an empty result.
  if (text.trim() === "") {
    throw new Error(
      `${redact(url)} returned an empty body. Treating this as "no data" is how ` +
        `a briefing once reported a flat account while positions were open.`,
    );
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${redact(url)} returned invalid JSON: ${text.slice(0, 200)}`);
  }
}

/** Strip query strings from URLs before they reach a log or an error message. */
function redact(url: string): string {
  const q = url.indexOf("?");
  return q === -1 ? url : url.slice(0, q) + "?…";
}

/**
 * GET and parse JSON, retrying transient failures.
 *
 * Without retries a transient blip waits out the full timeout and then hands
 * back nothing — which is exactly how an empty response becomes a wrong answer
 * downstream. Retrying costs a couple of seconds and is free of side effects.
 */
export async function getJson<T>(url: string, opts: GetOptions = {}): Promise<T> {
  const retries = opts.retries ?? 2;
  const delay = opts.retryDelayMs ?? 1_000;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return parse<T>(await request("GET", url, opts), url);
    } catch (err) {
      lastError = err;
      const retryable = !(err instanceof HttpError) || isRetryableStatus(err.status);
      if (attempt === retries || !retryable) break;
      await sleep(delay * (attempt + 1)); // linear backoff
    }
  }
  throw lastError;
}

/**
 * POST and parse JSON. **Exactly one attempt, by construction.**
 *
 * There is deliberately no `retries` option. A lost reply is indistinguishable
 * from a request that never landed, so retrying a POST to /v2/orders is a
 * coin-flip on filling twice. A bounded hang is recoverable; a double fill is
 * not. If this call fails, the caller reports it and the human decides.
 */
export async function postJson<T>(
  url: string,
  body: unknown,
  opts: RequestOptions = {},
): Promise<T> {
  const text = await request(
    "POST",
    url,
    { ...opts, headers: { "Content-Type": "application/json", ...opts.headers } },
    JSON.stringify(body),
  );
  return parse<T>(text, url);
}

/**
 * A bare connectivity probe. ANY HTTP status proves DNS, TCP, and TLS all work
 * end to end, so an unauthenticated 401 counts as success — this asks "is the
 * network usable", not "are my keys good".
 */
export async function canReach(url: string, timeoutMs = 8_000): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(url, { signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
