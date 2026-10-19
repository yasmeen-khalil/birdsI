import { getDb } from "@birdsi/db";
import { ApiError } from "./api";
import { envInt } from "./env";

/**
 * Fairness limits, enforced on the server before a job is queued. Model spend
 * is capped in the worker, before every call of the docs check, the only
 * thing that still calls a model; a map itself costs nothing.
 */
export async function assertUserScanQuota(userId: string): Promise<void> {
  const perDay = envInt("BIRDSI_USER_SCANS_PER_DAY", 40);
  const db = getDb();
  const since = new Date(Date.now() - 86_400_000).toISOString();
  // Maps still waiting or running count too, however long ago they were queued.
  const { count, error } = await db.from("scans").select("id", { count: "exact", head: true }).eq("owner_user_id", userId).or(`created_at.gte."${since}",status.in.(queued,running)`);
  if (error) throw new Error(`quota: ${error.message}`);
  if ((count ?? 0) + 1 > perDay) {
    throw new ApiError(429, "quota", "You have used today's allowance of maps. More opens up within 24 hours.");
  }
}

/** One running scan per repository at a time; a second request is refused with the running one's id. */
export async function runningScanForRepo(repoId: string): Promise<string | null> {
  const db = getDb();
  const { data, error } = await db.from("scans").select("id").eq("repo_id", repoId).in("status", ["queued", "running"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`runningScanForRepo: ${error.message}`);
  return (data as { id: string } | null)?.id ?? null;
}

/**
 * The scan that holds the repository's one running slot: the oldest queued
 * or running one. Checked after a new scan is inserted, so two requests that
 * both passed runningScanForRepo agree on a single winner.
 */
export async function firstActiveScanForRepo(repoId: string): Promise<string | null> {
  const db = getDb();
  const { data, error } = await db
    .from("scans")
    .select("id")
    .eq("repo_id", repoId)
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`firstActiveScanForRepo: ${error.message}`);
  return (data as { id: string } | null)?.id ?? null;
}
