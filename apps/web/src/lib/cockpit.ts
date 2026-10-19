import { latestServiceMap, MAPS_MIGRATION, mapsAvailable, repoForUser, serviceMapHistory, type UserRow } from "@birdsi/db";
import type { MapResponse } from "@birdsi/shared";

/**
 * The cockpit's reads for one app: the service map from its code. Shared by
 * the web pages and /api/v1, and therefore the CLI and the MCP server.
 */

export async function loadServiceMap(repoId: string, user: UserRow): Promise<MapResponse> {
  const repo = await repoForUser(repoId, user.id);
  if (!(await mapsAvailable())) return { map: null, history: [], reason: `Service maps are kept once the migration ${MAPS_MIGRATION} has run in the Supabase SQL editor.` };
  const [map, history] = await Promise.all([latestServiceMap(repo.id), serviceMapHistory(repo.id)]);
  return { map, history, reason: map ? null : "No service map of this app yet. Run birdsi in the app's folder, or map it from the Overview." };
}
