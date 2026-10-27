import type { LimitsDrift } from "@birdsi/shared";
import { getDb } from "./client";
import { schemaHas } from "./schema";

/** The weekly watch's rows. The table appears with migration 20261027000100. */
export const WATCH_MIGRATION = "20261027000100_limits_watch.sql";

interface WatchRow {
  vendor: string;
  url: string;
  checked_at: string;
  quotes_total: number;
  quotes_missing: Array<{ label: string; quote: string }>;
  proposal: string | null;
  error: string | null;
}

export function watchAvailable(): Promise<boolean> {
  return schemaHas("limits_watch");
}

export async function saveLimitsWatch(rows: LimitsDrift[]): Promise<boolean> {
  if (rows.length === 0 || !(await watchAvailable())) return false;
  const { error } = await getDb()
    .from("limits_watch")
    .insert(rows.map((r) => ({ vendor: r.vendor, url: r.url, checked_at: r.checkedAt, quotes_total: r.quotesTotal, quotes_missing: r.missing, proposal: r.proposal, error: r.error })));
  if (error) throw new Error(`saveLimitsWatch: ${error.message}`);
  return true;
}

/** The newest check of every page, one row per vendor and address. */
export async function latestLimitsWatch(): Promise<LimitsDrift[]> {
  if (!(await watchAvailable())) return [];
  const { data, error } = await getDb().from("limits_watch").select("vendor, url, checked_at, quotes_total, quotes_missing, proposal, error").order("checked_at", { ascending: false }).limit(500);
  if (error) throw new Error(`latestLimitsWatch: ${error.message}`);
  const seen = new Set<string>();
  const out: LimitsDrift[] = [];
  for (const r of (data ?? []) as WatchRow[]) {
    const key = `${r.vendor}\n${r.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ vendor: r.vendor, url: r.url, checkedAt: r.checked_at, quotesTotal: r.quotes_total, missing: r.quotes_missing ?? [], proposal: r.proposal, error: r.error });
  }
  return out;
}
