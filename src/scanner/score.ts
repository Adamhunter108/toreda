// Confidence scoring.
//
// A sum of NAMED components rather than a magic constant, so every score can
// show its work. This matters more than it sounds: a number with no derivation
// invites trust it has not earned, whereas "+5 momentum base, +1 volume
// confirms, -1 news does not corroborate" can be argued with.
//
// It is a heuristic ranking aid, NOT a calibrated probability. 8 means "look at
// this first", not "80% likely to work".

export interface Score {
  confidence: number;
  breakdown: string[];
}

/** Clamped to 1–9: nothing here has earned a 10, and 0 would read as "no signal". */
export function score(components: Array<[string, number]>): Score {
  const total = components.reduce((sum, [, value]) => sum + value, 0);
  return {
    confidence: Math.max(1, Math.min(9, total)),
    breakdown: components
      .filter(([, value]) => value !== 0)
      .map(([label, value]) => `${value > 0 ? "+" : ""}${value} ${label}`),
  };
}
