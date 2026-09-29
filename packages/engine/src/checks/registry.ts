import type { ScanKind } from "@birdsi/shared";
import type { EngineConfig } from "../config";
import { configCheck } from "./config";
import { crosscheckCheck } from "./crosscheck";
import { docsCheck } from "./docs";
import { freshnessCheck } from "./freshness";
import { reviewCheck } from "./review";
import { secretsCheck } from "./secrets";
import type { Check } from "./types";
import { vulnerabilitiesCheck } from "./vulnerabilities";

/**
 * Every check, in the order they run. Later checks can read the findings of
 * earlier ones. New checks (per ecosystem, per framework) are appended here.
 */
export const ALL_CHECKS: readonly Check[] = [
  secretsCheck,
  configCheck,
  vulnerabilitiesCheck,
  freshnessCheck,
  docsCheck,
  reviewCheck,
  crosscheckCheck,
];

export function checksFor(kind: ScanKind, config: EngineConfig): { active: Check[]; unavailable: Check[] } {
  const active: Check[] = [];
  const unavailable: Check[] = [];
  for (const check of ALL_CHECKS) {
    if (!check.tiers.includes(kind)) continue;
    if (check.available(config)) active.push(check);
    else unavailable.push(check);
  }
  return { active, unavailable };
}
