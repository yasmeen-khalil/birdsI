import { appsAvailable, ensureAppForRepo, latestReadsForApp, latestServiceMap, MAPS_MIGRATION, mapsAvailable, projectsForApp, READS_MIGRATION, readsAvailable, repoForUser, serviceMapHistory, type UserRow } from "@birdsi/db";
import { readsInDepth, type MapResponse, type ReadsResponse } from "@birdsi/shared";

/**
 * The cockpit's reads for one app: the service map from its code, and what
 * each vendor project said when birdsI last read it. Shared by the web pages
 * and /api/v1, and therefore the CLI and the MCP server.
 */

export async function loadServiceMap(repoId: string, user: UserRow): Promise<MapResponse> {
  const repo = await repoForUser(repoId, user.id);
  if (!(await mapsAvailable())) return { map: null, history: [], reason: `Service maps are kept once the migration ${MAPS_MIGRATION} has run in the Supabase SQL editor.` };
  const [map, history] = await Promise.all([latestServiceMap(repo.id), serviceMapHistory(repo.id)]);
  return { map, history, reason: map ? null : "No service map of this app yet. Run birdsi in the app's folder, or map it from the Overview." };
}

export async function loadReads(repoId: string, user: UserRow): Promise<ReadsResponse> {
  const repo = await repoForUser(repoId, user.id);
  if (!(await appsAvailable())) return { reads: [], reason: "Projects switch on when the migration 20261018000100_apps_projects.sql has run." };
  if (!(await readsAvailable())) return { reads: [], reason: `Project reads are kept once the migration ${READS_MIGRATION} has run in the Supabase SQL editor.` };
  const app = await ensureAppForRepo(repo);
  if (!app) return { reads: [], reason: "This app has no record yet." };
  const projects = (await projectsForApp(app.id)).filter((p) => readsInDepth(p.vendor, p.kind));
  if (projects.length === 0) return { reads: [], reason: "No Vercel project, Supabase project or OneSignal app is declared for this app yet. Add them on the Projects page." };
  const latest = await latestReadsForApp(app.id, projects.map((p) => p.id));
  const reads = projects.map((p) => latest.get(p.id)).filter((r): r is NonNullable<typeof r> => Boolean(r));
  return { reads, reason: reads.length > 0 ? null : "Not read yet. A project is read within the hour once its key is connected, or now with Read accounts." };
}
