import { getDb, totalSpend } from "@birdsi/db";
import type { ScanKind } from "@birdsi/shared";
import { ApiError } from "./api";
import { envInt } from "./env";

/**
 * Spending and fairness limits. They protect the hackathon credits through
 * judging and stop one user from consuming everything. All enforced on the
 * server before a job is queued.
 */
export async function assertSpendCap(): Promise<void> {
  const capUsd = envInt("BIRDSI_DAILY_SPEND_CAP_USD", 50);
  const spent = await totalSpend(new Date(Date.now() - 86_400_000));
  if (spent >= capUsd * 1_000_000) {
    throw new ApiError(402, "capacity", "birdsI has reached its daily scan budget. Scans open again within 24 hours.");
  }
}

/** Deep scans count three times and audits five, against one daily allowance. */
const WEIGHT: Record<ScanKind, number> = { light: 1, deep: 3, audit: 5 };

export async function assertUserScanQuota(userId: string, kind: ScanKind): Promise<void> {
  const perDay = envInt("BIRDSI_USER_SCANS_PER_DAY", 20);
  const db = getDb();
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { data, error } = await db.from("scans").select("kind").eq("owner_user_id", userId).gte("created_at", since);
  if (error) throw new Error(`quota: ${error.message}`);
  const used = ((data ?? []) as Array<{ kind: ScanKind }>).reduce((n, row) => n + (WEIGHT[row.kind] ?? 1), 0);
  if (used + WEIGHT[kind] > perDay) {
    throw new ApiError(429, "quota", "You have used today's scan allowance. More opens up within 24 hours.");
  }
}

/** One running scan per repository at a time; a second request is refused with the running one's id. */
export async function runningScanForRepo(repoId: string): Promise<string | null> {
  const db = getDb();
  const { data, error } = await db.from("scans").select("id").eq("repo_id", repoId).in("status", ["queued", "running"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`runningScanForRepo: ${error.message}`);
  return (data as { id: string } | null)?.id ?? null;
}
