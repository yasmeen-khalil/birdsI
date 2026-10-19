import { ServiceMap, type MapHistoryEntry, type StoredMap } from "@birdsi/shared";
import { getDb } from "./client";
import { schemaHas } from "./schema";

/**
 * Service maps, one per map of the code, kept dated so the cockpit has the
 * latest and the ones before it. The table appears with migration
 * 20261018000200; until then a map is read and shown during the run but not
 * kept, and the run says so.
 */

/** How many maps are kept per repository; older ones are deleted when a new one is saved. */
export const MAPS_KEPT = 30;

export const MAPS_MIGRATION = "20261018000200_service_maps.sql";

interface MapRow {
  id: string;
  repo_id: string;
  app_id: string | null;
  scan_id: string | null;
  commit_sha: string | null;
  branch: string | null;
  map: unknown;
  created_at: string;
}

export async function mapsAvailable(): Promise<boolean> {
  return schemaHas("service_maps");
}

/** Stores a map and deletes the ones beyond the newest MAPS_KEPT. False when the migration has not run. */
export async function saveServiceMap(input: { repoId: string; appId: string | null; scanId: string | null; map: ServiceMap }): Promise<boolean> {
  if (!(await mapsAvailable())) return false;
  const db = getDb();
  const { error } = await db.from("service_maps").insert({
    repo_id: input.repoId,
    app_id: input.appId,
    scan_id: input.scanId,
    commit_sha: input.map.commit,
    branch: input.map.branch,
    map: input.map,
  });
  if (error) throw new Error(`saveServiceMap: ${error.message}`);
  const old = await db.from("service_maps").select("id").eq("repo_id", input.repoId).order("created_at", { ascending: false }).range(MAPS_KEPT, MAPS_KEPT + 200);
  if (old.error) throw new Error(`saveServiceMap prune: ${old.error.message}`);
  const ids = ((old.data ?? []) as Array<{ id: string }>).map((r) => r.id);
  if (ids.length > 0) {
    const del = await db.from("service_maps").delete().in("id", ids);
    if (del.error) throw new Error(`saveServiceMap prune: ${del.error.message}`);
  }
  return true;
}

function toStored(row: MapRow): StoredMap | null {
  const parsed = ServiceMap.safeParse(row.map);
  // A map written by an older reader that no longer parses is skipped, never shown half-read.
  if (!parsed.success) return null;
  return { appId: row.app_id, repoId: row.repo_id, scanId: row.scan_id, createdAt: row.created_at, map: parsed.data };
}

/** The newest map of a repository, or null when there is none or the migration has not run. */
export async function latestServiceMap(repoId: string): Promise<StoredMap | null> {
  if (!(await mapsAvailable())) return null;
  const { data, error } = await getDb().from("service_maps").select().eq("repo_id", repoId).order("created_at", { ascending: false }).limit(5);
  if (error) throw new Error(`latestServiceMap: ${error.message}`);
  for (const row of (data ?? []) as MapRow[]) {
    const stored = toStored(row);
    if (stored) return stored;
  }
  return null;
}

/** The dates and commits of a repository's maps, newest first, without the maps. */
export async function serviceMapHistory(repoId: string, limit = MAPS_KEPT): Promise<MapHistoryEntry[]> {
  if (!(await mapsAvailable())) return [];
  const { data, error } = await getDb().from("service_maps").select("id, created_at, commit_sha, branch, scan_id").eq("repo_id", repoId).order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error(`serviceMapHistory: ${error.message}`);
  return ((data ?? []) as Array<Pick<MapRow, "id" | "created_at" | "commit_sha" | "branch" | "scan_id">>).map((r) => ({ id: r.id, createdAt: r.created_at, commit: r.commit_sha, branch: r.branch, scanId: r.scan_id }));
}
