import { addDeadline, ALERTS_MIGRATION, alertsAvailable, alertsForApp, appsAvailable, deadlinesForApp, ensureAppForRepo, latestReadsForApp, latestServiceMap, MAPS_MIGRATION, mapsAvailable, projectsForApp, READS_MIGRATION, readsAvailable, removeDeadline, repoForUser, serviceMapHistory, type UserRow } from "@birdsi/db";
import { AddDeadlineRequest, alertEmailState, readsInDepth, type AlertsResponse, type AppDeadline, type MapResponse, type ReadsResponse } from "@birdsi/shared";
import { ApiError } from "./api";
import { note, ownerAuthor } from "./record";

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

/** Whether alerts are emailed: the key on birdsI (the web app and the worker share their env), the address, the choice in Settings. */
export function emailStateFor(user: UserRow) {
  return alertEmailState(Boolean(process.env["RESEND_API_KEY"]?.trim()), { email: user.email, email_updates: user.email_updates });
}

export async function loadAlerts(repoId: string, user: UserRow): Promise<AlertsResponse> {
  const repo = await repoForUser(repoId, user.id);
  const email = emailStateFor(user);
  if (!(await appsAvailable())) return { alerts: [], deadlines: [], email, reason: "Apps switch on when the migration 20261018000100_apps_projects.sql has run." };
  if (!(await alertsAvailable())) return { alerts: [], deadlines: [], email, reason: `Alerts are kept once the migration ${ALERTS_MIGRATION} has run in the Supabase SQL editor.` };
  const app = await ensureAppForRepo(repo);
  if (!app) return { alerts: [], deadlines: [], email, reason: "This app has no record yet." };
  const [alerts, deadlines] = await Promise.all([alertsForApp(app.id), deadlinesForApp(app.id)]);
  return { alerts, deadlines, email, reason: null };
}

/** Adds a date to watch: the alert stream warns from 30 days before it. */
export async function addAppDeadline(repoId: string, user: UserRow, input: unknown): Promise<AppDeadline> {
  const parsed = AddDeadlineRequest.safeParse(input);
  if (!parsed.success) throw new ApiError(400, "bad_request", parsed.error.issues[0]?.message ?? "Give a label of 2 to 120 characters and a date.");
  if (Number.isNaN(Date.parse(`${parsed.data.dueOn}T00:00:00Z`))) throw new ApiError(400, "bad_request", "That date does not exist.");
  const repo = await repoForUser(repoId, user.id);
  if (!(await alertsAvailable())) throw new ApiError(503, "not_ready", `Dates to watch switch on when the migration ${ALERTS_MIGRATION} has run.`);
  const app = await ensureAppForRepo(repo);
  if (!app) throw new ApiError(503, "not_ready", "Apps switch on when the migration 20261018000100_apps_projects.sql has run.");
  const added = await addDeadline(app.id, user.id, parsed.data);
  await note(repo.id, ownerAuthor(user), { kind: "project", subject: `date:${added.id}`, text: `Watch ${added.label} on ${added.dueOn}.` });
  return added;
}

export async function removeAppDeadline(repoId: string, user: UserRow, deadlineId: string): Promise<void> {
  const repo = await repoForUser(repoId, user.id);
  const removed = await removeDeadline(deadlineId, user.id);
  await note(repo.id, ownerAuthor(user), { kind: "project", subject: `date:${removed.id}`, text: `No longer watching ${removed.label} on ${removed.dueOn}.` });
}
