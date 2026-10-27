import { repoForUser, type UserRow } from "@birdsi/db";
import { checklistView, type ChecklistView } from "@birdsi/shared";
import { latestDone } from "@/components/server/data";
import { loadApp } from "./apps";
import { loadAlerts, loadServiceMap } from "./cockpit";

/** What birdsI still needs from the owner for this app, from the map, the projects, the keys and the newest map's scope. */
export async function loadChecklist(repoId: string, user: UserRow): Promise<ChecklistView> {
  const repo = await repoForUser(repoId, user.id);
  const [appData, mapData, alertData, latest] = await Promise.all([loadApp(repo.id, user), loadServiceMap(repo.id, user), loadAlerts(repo.id, user), latestDone(repo.id)]);
  return checklistView({
    appName: appData.app?.name ?? repo.full_name.split("/").pop() ?? repo.full_name,
    appReady: appData.app !== null,
    projects: appData.app?.projects ?? [],
    untiedKeys: appData.untiedKeys,
    map: mapData.map,
    scope: latest?.summary?.scope ?? null,
    email: alertData.email,
    deadlines: alertData.deadlines.length,
  });
}
