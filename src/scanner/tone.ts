// Headline tone.
//
// This is the layer that once turned a flat NVDA position into a confidence-9
// SELL off two keyword hits across nineteen stories — one of which was `miss`
// matching inside "Missing" in a bullish headline. Tone cannot protect money
// the way a stop does, but it can certainly spend it, so every failure mode
// below is asserted in tone.test.ts rather than eyeballed in a live scan.
//
// Only news uses this. Social posts carry StockTwits' own author-declared
// Bullish/Bearish tag, which is real data and beats guessing from words.

export type Tone = "bullish" | "bearish" | "neutral";

/**
 * Base forms only. `toneWords` matches an optional -s/-es/-ed/-d.
 *
 * Deliberately NOT -ing: "missing" in "the AI stock investors are missing" is
 * bullish framing, and matching it as `miss` is exactly the false positive this
 * vocabulary is most prone to.
 */
export const BULL_WORDS = [
  "beat",
  "upgrade",
  "surge",
  "rally",
  "record",
  "raise",
  "win",
  "won",
  "approval",
];

export const BEAR_WORDS = [
  "miss",
  "downgrade",
  "plunge",
  "fall",
  "fell",
  "cut",
  "probe",
  "lawsuit",
  "recall",
  "warning",
];

/**
 * Which of `words` appear in `text` as WHOLE words.
 *
 * Substring matching is unsafe for this vocabulary: `miss` sits inside
 * "missing", "commission" and "missile"; `fall` inside "shortfall"; `cut`
 * inside "executing"; `record` inside "recording". Every one of those is a
 * headline a mega-cap sees weekly.
 */
export function toneWords(text: string, words: string[]): string[] {
  const t = text.toLowerCase();
  // `d` as well as `ed`, because the e-ending stems take a bare -d:
  // "upgrade" → "upgraded".
  return words.filter((w) => new RegExp(`\\b${w}(s|es|ed|d)?\\b`).test(t));
}

/**
 * True when a headline is merely reporting the price move itself, as in
 * "Nvidia Stock Falls 5%: ...".
 *
 * These are excluded from tone entirely. They carry no information beyond the
 * move, which the price channel already scores — letting them also set tone
 * counts one fact twice and lets a signal corroborate itself.
 */
export function isPriceReport(headline: string): boolean {
  const t = headline.toLowerCase();
  const move =
    /\b(falls?|fell|drops?|dropped|slides?|slid|sinks?|sank|tumbles?|plunges?|rises?|rose|climbs?|jumps?|gains?|soars?|surges?|rallies|rallied|adds?|sheds?)\b[^.]{0,24}\d+(\.\d+)?%/;
  const pctFirst = /\d+(\.\d+)?%[^.]{0,24}\b(higher|lower|drop|gain|fall|jump|rise|decline)\b/;
  return move.test(t) || pctFirst.test(t);
}

/** Tone of ONE headline, by whole-word keyword count. */
export function headlineTone(headline: string): Tone {
  const bull = toneWords(headline, BULL_WORDS).length;
  const bear = toneWords(headline, BEAR_WORDS).length;
  if (bull > bear) return "bullish";
  if (bear > bull) return "bearish";
  return "neutral";
}

/** Below this many headlines on the winning side, a lean is an anecdote. */
export const MIN_TONED_HEADLINES = 2;

export interface NewsTone {
  tone: Tone;
  bull: number;
  bear: number;
  /** Headlines eligible to carry tone — price reports excluded. */
  scored: number;
  priceReports: number;
  /**
   * The headlines that actually produced the winning tone, in feed order.
   *
   * Surfaced so a report can show the evidence a signal was scored on. The
   * first few headlines of a mega-cap's feed are usually unrelated to whatever
   * moved the score, so showing those instead makes a signal look arbitrary
   * even when it is not.
   */
  drivers: string[];
}

/**
 * Tone across a symbol's headlines, scored ONE HEADLINE AT A TIME.
 *
 * The version this replaced concatenated every headline into a single string
 * and asked whether any bear word appeared anywhere in the blob — so one stray
 * word in 1 of 30 stories set the tone for all of them. Counting HEADLINES
 * rather than WORDS IN A BLOB means a lean has to actually recur, and requiring
 * MIN_TONED_HEADLINES on the winning side keeps one-off wording from directing
 * a trade.
 */
export function aggregateTone(headlines: string[]): NewsTone {
  const eligible = headlines.filter((h) => !isPriceReport(h));
  const bullish: string[] = [];
  const bearish: string[] = [];

  for (const h of eligible) {
    const t = headlineTone(h);
    if (t === "bullish") bullish.push(h);
    else if (t === "bearish") bearish.push(h);
  }

  const bull = bullish.length;
  const bear = bearish.length;
  const lead = Math.max(bull, bear);
  const tone: Tone =
    lead < MIN_TONED_HEADLINES || bull === bear ? "neutral" : bull > bear ? "bullish" : "bearish";

  return {
    tone,
    bull,
    bear,
    scored: eligible.length,
    priceReports: headlines.length - eligible.length,
    drivers: tone === "bullish" ? bullish : tone === "bearish" ? bearish : [],
  };
}
