import type { EngineConfig } from "../config";
import { configCheck } from "./config";
import { docsCheck } from "./docs";
import { freshnessCheck } from "./freshness";
import { secretsCheck } from "./secrets";
import type { Check } from "./types";
import { vulnerabilitiesCheck } from "./vulnerabilities";

/**
 * Every check, in the order they run. Later checks can read the findings of
 * earlier ones. All of them are rules or databases except the docs check,
 * which reads a package's own current documentation and must cite it.
 */
export const ALL_CHECKS: readonly Check[] = [secretsCheck, configCheck, vulnerabilitiesCheck, freshnessCheck, docsCheck];

export function checksFor(config: EngineConfig): { active: Check[]; unavailable: Check[] } {
  const active: Check[] = [];
  const unavailable: Check[] = [];
  for (const check of ALL_CHECKS) {
    if (check.available(config)) active.push(check);
    else unavailable.push(check);
  }
  return { active, unavailable };
}
