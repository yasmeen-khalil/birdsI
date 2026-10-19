import { ProjectReadData, readParts, type ProjectRead } from "@birdsi/shared";
import { getDb } from "./client";
import { schemaHas } from "./schema";

/**
 * Project reads: what each vendor project said when birdsI last read it. The
 * table appears with migration 20261018000300; until then a read is made and
 * its facts kept, and the cockpit says the reads wait on the migration.
 */

export const READS_KEPT = 48;
export const READS_MIGRATION = "20261018000300_project_reads.sql";

interface ReadRow {
  id: string;
  app_id: string;
  app_project_id: string;
  vendor: string;
  read_at: string;
  problems: number;
  data: unknown;
}

export async function readsAvailable(): Promise<boolean> {
  return schemaHas("project_reads");
}

/** How many parts of a read could not be read. */
export function problemCount(data: ProjectReadData): number {
  return readParts(data).filter((p) => !p.reading.ok).length;
}

/** Stores one read and deletes the ones beyond the newest READS_KEPT for that project. False when the migration has not run. */
export async function saveProjectRead(input: { appId: string; projectId: string; data: ProjectReadData; readAt?: string }): Promise<boolean> {
  if (!(await readsAvailable())) return false;
  const db = getDb();
  const { error } = await db.from("project_reads").insert({
    app_id: input.appId,
    app_project_id: input.projectId,
    vendor: input.data.vendor,
    read_at: input.readAt ?? new Date().toISOString(),
    problems: problemCount(input.data),
    data: input.data,
  });
  if (error) throw new Error(`saveProjectRead: ${error.message}`);
  const old = await db.from("project_reads").select("id").eq("app_project_id", input.projectId).order("read_at", { ascending: false }).range(READS_KEPT, READS_KEPT + 200);
  if (old.error) throw new Error(`saveProjectRead prune: ${old.error.message}`);
  const ids = ((old.data ?? []) as Array<{ id: string }>).map((r) => r.id);
  if (ids.length > 0) {
    const del = await db.from("project_reads").delete().in("id", ids);
    if (del.error) throw new Error(`saveProjectRead prune: ${del.error.message}`);
  }
  return true;
}

function toRead(row: ReadRow): ProjectRead | null {
  const parsed = ProjectReadData.safeParse(row.data);
  if (!parsed.success) return null;
  return { id: row.id, appId: row.app_id, projectId: row.app_project_id, vendor: row.vendor, readAt: row.read_at, problems: row.problems, data: parsed.data };
}

/** The newest read of each of an app's projects. */
export async function latestReadsForApp(appId: string, projectIds: string[]): Promise<Map<string, ProjectRead>> {
  const out = new Map<string, ProjectRead>();
  if (projectIds.length === 0 || !(await readsAvailable())) return out;
  const db = getDb();
  // One small query per project keeps it to the newest rows without a window function.
  await Promise.all(
    projectIds.map(async (projectId) => {
      const { data, error } = await db.from("project_reads").select().eq("app_id", appId).eq("app_project_id", projectId).order("read_at", { ascending: false }).limit(3);
      if (error) throw new Error(`latestReadsForApp: ${error.message}`);
      for (const row of (data ?? []) as ReadRow[]) {
        const read = toRead(row);
        if (read) {
          out.set(projectId, read);
          break;
        }
      }
    }),
  );
  return out;
}
