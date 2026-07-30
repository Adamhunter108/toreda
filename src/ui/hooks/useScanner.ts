// Manual-only scanner runs, triggered by `r`. Nothing scans until asked, so the
// dashboard never hits the news or social APIs on its own.
//
// The source project ran the scanner as a SUBPROCESS, because it was fully
// synchronous (execSync + curl) and would have frozen the render loop. Now that
// it is async fetch throughout it runs in-process, which removes the subprocess
// spawn, the JSON round-trip, the tsx path resolution, and a whole class of
// "scanner output was not valid JSON" failures.
import { useCallback, useRef, useState } from "react";
import { readFileSync } from "node:fs";
import { runScan } from "../../scanner";
import type { ScanResult } from "../../scanner/types";

/** Preload a scan result from a file so the signals UI can render without a
 *  live scan. Used by the headless smoke test. */
function mockResult(): ScanResult | null {
  const file = process.env.DASH_MOCK_SCAN_FILE;
  if (!file) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as ScanResult;
  } catch {
    return null;
  }
}

export function useScanner() {
  const [result, setResult] = useState<ScanResult | null>(mockResult);
  const [scanning, setScanning] = useState(false);
  const [lastRun, setLastRun] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const refresh = useCallback(() => {
    // Guard against a second scan while one is in flight — holding `r` would
    // otherwise fan out concurrent scans and rate-limit the account.
    if (busy.current) return;
    busy.current = true;
    setScanning(true);
    setError(null);

    runScan()
      .then((r) => {
        setResult(r);
        setLastRun(new Date());
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        busy.current = false;
        setScanning(false);
      });
  }, []);

  return { result, scanning, lastRun, error, refresh };
}
