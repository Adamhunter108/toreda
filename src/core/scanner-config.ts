// config/scanner.json — the scanner's thresholds and toggles.
//
// Every knob the scanner reads lives here rather than as a constant in the
// scanning code, so tuning it needs no code change and the dashboard's settings
// view can edit the same file the next scan reads.

import {
  loadJsonConfig,
  pickBoolean,
  pickNumber,
  pickObject,
  pickStringArray,
  saveJsonConfig,
} from "./json-config";

export interface SignalTypeToggles {
  momentum: boolean;
  value_play: boolean;
  news_catalyst: boolean;
  social_buzz: boolean;
}

export interface ScannerThresholds {
  /** Percent move over the lookback window that counts as momentum. */
  momentumPct: number;
  /** Volume multiple of the window average required to confirm a move. */
  momentumVolumeMult: number;
  /** Percent drawdown that marks a possible oversold entry. Negative. */
  valuePullbackPct: number;
  /** Absolute floor for price confirming a news tone or a social lean. */
  newsPriceAgreePct: number;
  /** Multiples of the symbol's OWN volatility. See the scanner's docs. */
  newsPriceAgreeSigma: number;
  /** Share of tagged posts on one side needed to call a social lean. */
  socialBullShare: number;
}

export interface DiscoveryConfig {
  enabled: boolean;
  /** Below this, it is a penny stock however far it moved. */
  minPrice: number;
  /** Previous session's dollar volume. Thin names cannot be exited. */
  minDollarVolume: number;
}

export interface ScannerConfig {
  minConfidence: number;
  maxSignals: number;
  lookbackDays: number;
  signalTypes: SignalTypeToggles;
  thresholds: ScannerThresholds;
  discovery: DiscoveryConfig;
  /** Empty means every sector. */
  sectorFocus: string[];
  /**
   * StockTwits is an undocumented public API with no stability guarantee. When
   * false the social signal is skipped entirely rather than failing the scan.
   */
  useStockTwits: boolean;
}

export const DEFAULT_SCANNER_CONFIG: ScannerConfig = {
  minConfidence: 7,
  maxSignals: 12,
  lookbackDays: 14,
  signalTypes: {
    momentum: true,
    value_play: true,
    news_catalyst: true,
    social_buzz: true,
  },
  thresholds: {
    momentumPct: 5,
    momentumVolumeMult: 1.2,
    valuePullbackPct: -8,
    newsPriceAgreePct: 2,
    newsPriceAgreeSigma: 1,
    socialBullShare: 0.7,
  },
  discovery: {
    enabled: true,
    minPrice: 10,
    minDollarVolume: 25_000_000,
  },
  sectorFocus: [],
  useStockTwits: true,
};

export function loadScannerConfig(): ScannerConfig {
  return loadJsonConfig<ScannerConfig>(
    "scanner.json",
    DEFAULT_SCANNER_CONFIG,
    (raw, defaults) => {
      const types = pickObject(raw, "signalTypes");
      const thresholds = pickObject(raw, "thresholds");
      const discovery = pickObject(raw, "discovery");
      return {
        minConfidence: pickNumber(raw, "minConfidence", defaults.minConfidence),
        maxSignals: pickNumber(raw, "maxSignals", defaults.maxSignals),
        lookbackDays: pickNumber(raw, "lookbackDays", defaults.lookbackDays),
        signalTypes: {
          momentum: pickBoolean(types, "momentum", defaults.signalTypes.momentum),
          value_play: pickBoolean(types, "value_play", defaults.signalTypes.value_play),
          news_catalyst: pickBoolean(types, "news_catalyst", defaults.signalTypes.news_catalyst),
          social_buzz: pickBoolean(types, "social_buzz", defaults.signalTypes.social_buzz),
        },
        thresholds: {
          momentumPct: pickNumber(thresholds, "momentumPct", defaults.thresholds.momentumPct),
          momentumVolumeMult: pickNumber(
            thresholds,
            "momentumVolumeMult",
            defaults.thresholds.momentumVolumeMult,
          ),
          valuePullbackPct: pickNumber(
            thresholds,
            "valuePullbackPct",
            defaults.thresholds.valuePullbackPct,
          ),
          newsPriceAgreePct: pickNumber(
            thresholds,
            "newsPriceAgreePct",
            defaults.thresholds.newsPriceAgreePct,
          ),
          newsPriceAgreeSigma: pickNumber(
            thresholds,
            "newsPriceAgreeSigma",
            defaults.thresholds.newsPriceAgreeSigma,
          ),
          socialBullShare: pickNumber(
            thresholds,
            "socialBullShare",
            defaults.thresholds.socialBullShare,
          ),
        },
        discovery: {
          enabled: pickBoolean(discovery, "enabled", defaults.discovery.enabled),
          minPrice: pickNumber(discovery, "minPrice", defaults.discovery.minPrice),
          minDollarVolume: pickNumber(
            discovery,
            "minDollarVolume",
            defaults.discovery.minDollarVolume,
          ),
        },
        sectorFocus: pickStringArray(raw, "sectorFocus", defaults.sectorFocus),
        useStockTwits: pickBoolean(raw, "useStockTwits", defaults.useStockTwits),
      };
    },
  ).value;
}

export function saveScannerConfig(config: ScannerConfig): void {
  saveJsonConfig("scanner.json", config);
}
