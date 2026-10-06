import { getDb } from "./client";

type Feature = "jobs.priority" | "workers";

const known = new Map<Feature, { ok: boolean; at: number }>();
const RECHECK_MS = 10 * 60_000;

/**
 * Whether a column or table from a newer migration exists yet. The code can
 * deploy before the owner runs the migration; a missing feature is simply not
 * used and is checked again every ten minutes, so the migration is picked up
 * without a restart. Any other failure also counts as "not yet".
 */
export async function schemaHas(feature: Feature): Promise<boolean> {
  const cached = known.get(feature);
  if (cached && (cached.ok || Date.now() - cached.at < RECHECK_MS)) return cached.ok;
  let ok = false;
  try {
    const db = getDb();
    const probe = feature === "jobs.priority" ? db.from("jobs").select("priority").limit(1) : db.from("workers").select("id").limit(1);
    const { error } = await probe;
    ok = !error;
  } catch {
    ok = false;
  }
  known.set(feature, { ok, at: Date.now() });
  return ok;
}
