// Your risk rules, kept in step with config/risk.json.
//
// The dashboard is not the only thing that edits this file: you might, by
// hand, and Claude does when asked to change a rule (see CLAUDE.md). Reading it
// once at startup would leave the rules panel checking yesterday's stop while
// the file says something else — so the file's mtime is polled, and the rules
// reload when it changes. A stat every few seconds is effectively free.
import { statSync } from "node:fs";
import { useCallback, useEffect, useRef, useState } from "react";
import { configFile } from "../../core/paths";
import { loadRiskRules, saveRiskRules, type RiskRules } from "../../core/risk";

function mtime(): number {
  try {
    return statSync(configFile("risk.json")).mtimeMs;
  } catch {
    return 0; // no user file yet — the shipped defaults apply
  }
}

export function useRiskRules(pollMs = 3_000) {
  const [rules, setRules] = useState<RiskRules>(loadRiskRules);
  const stamp = useRef(mtime());

  useEffect(() => {
    const id = setInterval(() => {
      const m = mtime();
      if (m !== stamp.current) {
        stamp.current = m;
        setRules(loadRiskRules());
      }
    }, pollMs);
    return () => clearInterval(id);
  }, [pollMs]);

  /** Re-read now. Used when opening the editor, so it never starts stale. */
  const reload = useCallback((): RiskRules => {
    stamp.current = mtime();
    const fresh = loadRiskRules();
    setRules(fresh);
    return fresh;
  }, []);

  /**
   * Write `next`, but only if the file still holds `baseline` — the rules the
   * edit started from. If something else changed the file meanwhile, saving
   * would silently undo that change; refusing is the only safe answer.
   */
  const save = useCallback(
    (next: RiskRules, baseline: RiskRules): { ok: true } | { ok: false; error: string } => {
      if (JSON.stringify(loadRiskRules()) !== JSON.stringify(baseline)) {
        return {
          ok: false,
          error:
            "config/risk.json changed on disk while you were editing — nothing was saved. " +
            "Close and reopen the editor to start from the current rules.",
        };
      }
      try {
        saveRiskRules(next);
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
      stamp.current = mtime();
      setRules(next);
      return { ok: true };
    },
    [],
  );

  return { rules, reload, save };
}
