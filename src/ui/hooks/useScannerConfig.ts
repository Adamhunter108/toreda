// Live-editable scanner config. Every mutation persists to config/scanner.json
// immediately, so the next `r` scan uses it.
import { useCallback, useState } from "react";
import {
  loadScannerConfig,
  saveScannerConfig,
  type ScannerConfig,
} from "../../core/scanner-config";

export function useScannerConfig() {
  const [config, setConfig] = useState<ScannerConfig>(loadScannerConfig);

  const update = useCallback((mutate: (c: ScannerConfig) => ScannerConfig) => {
    setConfig((prev) => {
      const next = mutate(structuredClone(prev));
      saveScannerConfig(next);
      return next;
    });
  }, []);

  return { config, update };
}
