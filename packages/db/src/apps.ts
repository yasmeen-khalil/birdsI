import { createHmac } from "node:crypto";
import { PROJECT_VENDOR_BY_SLUG, projectDashboardUrl, type App, type AppProject, type Environment, type ProjectKey, type ProjectKind, type UntiedKey } from "@birdsi/shared";
import { ForbiddenError, getDb, NotFoundError, unwrap } from "./client";
import { encryptSecret, type ConnectionRow } from "./connections";
import { schemaHas } from "./schema";

/**
 * Apps, the vendor projects each one has, and the read key tied to each
 * project. Every function takes the acting user and checks ownership; the
 * apps table appears with migration 20261018000100, and until then these
 * functions say so instead of failing.
 */

export interface AppRow {
  id: string;
  owner_user_id: string;
  repo_id: string;
  name: string;
  environments: string[];
  created_at: string;
  updated_at: string;
}

export interface AppProjectRow {
  id: string;
  app_id: string;
  vendor: string;
  kind: ProjectKind;
  ref: string;
  label: string | null;
  environment: Environment | null;
  plan: string | null;
  settings: Record<string, string>;
  created_at: string;
}

/** Thrown when a feature waits on a migration the owner has not run. */
export class NotReadyError extends Error {
  override name = "NotReadyError";
}

export async function appsAvailable(): Promise<boolean> {
  return (await schemaHas("apps")) && (await schemaHas("connections.app_project_id"));
}

async function requireApps(): Promise<void> {
  if (!(await appsAvailable())) throw new NotReadyError("Apps and keys per project switch on when the migration 20261018000100_apps_projects.sql has run.");
}

function repoName(fullName: string): string {
  const slash = fullName.lastIndexOf("/");
  return slash === -1 ? fullName : fullName.slice(slash + 1);
}

/**
 * The app of a repository, made the first time it is asked for: every
 * repository is an app. Null before the migration has run.
 */
export async function ensureAppForRepo(repo: { id: string; owner_user_id: string; full_name: string }): Promise<AppRow | null> {
  if (!(await appsAvailable())) return null;
  const db = getDb();
  const found = await db.from("apps").select().eq("repo_id", repo.id).maybeSingle();
  if (found.error) throw new Error(`ensureAppForRepo: ${found.error.message}`);
  if (found.data) return found.data as AppRow;
  const { error } = await db.from("apps").upsert({ owner_user_id: repo.owner_user_id, repo_id: repo.id, name: repoName(repo.full_name) }, { onConflict: "repo_id", ignoreDuplicates: true });
  if (error) throw new Error(`ensureAppForRepo insert: ${error.message}`);
  const again = await db.from("apps").select().eq("repo_id", repo.id).single();
  return unwrap(again, "ensureAppForRepo") as AppRow;
}

export async function appForUser(appId: string, userId: string): Promise<AppRow> {
  await requireApps();
  const db = getDb();
  const { data, error } = await db.from("apps").select().eq("id", appId).maybeSingle();
  if (error) throw new Error(`appForUser: ${error.message}`);
  const row = data as AppRow | null;
  if (!row) throw new NotFoundError("app");
  if (row.owner_user_id !== userId) throw new ForbiddenError("app");
  return row;
}

export async function appsForUser(userId: string): Promise<AppRow[]> {
  if (!(await appsAvailable())) return [];
  const db = getDb();
  const { data, error } = await db.from("apps").select().eq("owner_user_id", userId).order("name");
  if (error) throw new Error(`appsForUser: ${error.message}`);
  return (data ?? []) as AppRow[];
}

export async function updateApp(appId: string, userId: string, patch: { name?: string; environments?: Environment[] }): Promise<AppRow> {
  await appForUser(appId, userId);
  const db = getDb();
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) update["name"] = patch.name;
  if (patch.environments !== undefined) update["environments"] = patch.environments;
  const result = await db.from("apps").update(update).eq("id", appId).select().single();
  return unwrap(result, "updateApp") as AppRow;
}

export async function projectsForApp(appId: string): Promise<AppProjectRow[]> {
  const db = getDb();
  const { data, error } = await db.from("app_projects").select().eq("app_id", appId).order("vendor").order("created_at");
  if (error) throw new Error(`projectsForApp: ${error.message}`);
  return (data ?? []) as AppProjectRow[];
}

export async function projectForUser(projectId: string, userId: string): Promise<{ project: AppProjectRow; app: AppRow }> {
  await requireApps();
  const db = getDb();
  const { data, error } = await db.from("app_projects").select().eq("id", projectId).maybeSingle();
  if (error) throw new Error(`projectForUser: ${error.message}`);
  const project = data as AppProjectRow | null;
  if (!project) throw new NotFoundError("project");
  const app = await appForUser(project.app_id, userId);
  return { project, app };
}

export async function addProject(appId: string, userId: string, input: { vendor: string; kind: ProjectKind; ref: string; label: string | null; environment: Environment | null; plan: string | null; settings: Record<string, string> }): Promise<AppProjectRow> {
  await appForUser(appId, userId);
  const db = getDb();
  const result = await db
    .from("app_projects")
    .insert({ app_id: appId, vendor: input.vendor, kind: input.kind, ref: input.ref, label: input.label, environment: input.environment, plan: input.plan, settings: input.settings })
    .select()
    .single();
  if (result.error && /duplicate key|unique/i.test(result.error.message)) throw new Error("This app already has that project.");
  return unwrap(result, "addProject") as AppProjectRow;
}

export async function updateProject(projectId: string, userId: string, patch: { label?: string | null; environment?: Environment | null; plan?: string | null; settings?: Record<string, string> }): Promise<AppProjectRow> {
  await projectForUser(projectId, userId);
  const db = getDb();
  const result = await db.from("app_projects").update(patch).eq("id", projectId).select().single();
  return unwrap(result, "updateProject") as AppProjectRow;
}

/** Removes a project and the key tied to it (the key cascades). */
export async function removeProject(projectId: string, userId: string): Promise<void> {
  await projectForUser(projectId, userId);
  const db = getDb();
  const { error } = await db.from("app_projects").delete().eq("id", projectId);
  if (error) throw new Error(`removeProject: ${error.message}`);
}

/**
 * A keyed hash of a key: the same for the same key, so the page can say two
 * projects share one, and useless to anyone without birdsI's secret.
 */
export function keyFingerprint(token: string): string {
  const secret = process.env["BIRDSI_SECRETS_KEY"]?.trim() ?? "";
  return createHmac("sha256", `birdsi-key-fingerprint:${secret}`).update(token).digest("hex").slice(0, 12);
}

/** Stores the read key for one project, replacing the one it had. The caller has proved the key works. */
export async function saveProjectKey(projectId: string, userId: string, input: { vendor: string; token: string; label: string | null }): Promise<void> {
  const { project } = await projectForUser(projectId, userId);
  const db = getDb();
  const row = {
    owner_user_id: userId,
    vendor_slug: input.vendor,
    app_id: project.app_id,
    app_project_id: project.id,
    label: input.label,
    token_ciphertext: encryptSecret(input.token),
    key_fingerprint: keyFingerprint(input.token),
    scope: "read",
    settings: {},
    last_probed_at: null,
    last_status: null,
    last_error: null,
  };
  const { error: delError } = await db.from("connections").delete().eq("app_project_id", project.id);
  if (delError) throw new Error(`saveProjectKey replace: ${delError.message}`);
  const { error } = await db.from("connections").insert(row);
  if (error) throw new Error(`saveProjectKey: ${error.message}`);
}

/** Copies a key the owner already gave birdsI to another project, server side: the key never travels back to a page. */
export async function reuseProjectKey(projectId: string, userId: string, fromConnectionId: string): Promise<void> {
  const { project } = await projectForUser(projectId, userId);
  const source = await connectionForUser(fromConnectionId, userId);
  if (source.vendor_slug !== project.vendor) throw new Error("That key is for another vendor.");
  const db = getDb();
  const { error: delError } = await db.from("connections").delete().eq("app_project_id", project.id);
  if (delError) throw new Error(`reuseProjectKey replace: ${delError.message}`);
  const { error } = await db.from("connections").insert({
    owner_user_id: userId,
    vendor_slug: project.vendor,
    app_id: project.app_id,
    app_project_id: project.id,
    label: source.label,
    token_ciphertext: source.token_ciphertext,
    key_fingerprint: source.key_fingerprint,
    scope: "read",
    settings: {},
  });
  if (error) throw new Error(`reuseProjectKey: ${error.message}`);
}

export async function removeProjectKey(projectId: string, userId: string): Promise<void> {
  await projectForUser(projectId, userId);
  const db = getDb();
  const { error } = await db.from("connections").delete().eq("app_project_id", projectId);
  if (error) throw new Error(`removeProjectKey: ${error.message}`);
}

export async function connectionForUser(connectionId: string, userId: string): Promise<ConnectionRow & { app_id: string | null; app_project_id: string | null; key_fingerprint: string | null }> {
  const db = getDb();
  const { data, error } = await db.from("connections").select().eq("id", connectionId).maybeSingle();
  if (error) throw new Error(`connectionForUser: ${error.message}`);
  const row = data as (ConnectionRow & { app_id: string | null; app_project_id: string | null; key_fingerprint: string | null }) | null;
  if (!row) throw new NotFoundError("connection");
  if (row.owner_user_id !== userId) throw new ForbiddenError("connection");
  return row;
}

export type ProjectConnectionRow = ConnectionRow & { app_id: string; app_project_id: string; key_fingerprint: string | null; scope: string };

export async function connectionsForApp(appId: string): Promise<ProjectConnectionRow[]> {
  const db = getDb();
  const { data, error } = await db.from("connections").select().eq("app_id", appId).not("app_project_id", "is", null);
  if (error) throw new Error(`connectionsForApp: ${error.message}`);
  return (data ?? []) as ProjectConnectionRow[];
}

/** Keys connected before keys were tied to projects, still untied. */
export async function untiedConnections(userId: string): Promise<ConnectionRow[]> {
  const db = getDb();
  const query = (await appsAvailable()) ? db.from("connections").select().eq("owner_user_id", userId).is("app_project_id", null) : db.from("connections").select().eq("owner_user_id", userId);
  const { data, error } = await query.order("vendor_slug");
  if (error) throw new Error(`untiedConnections: ${error.message}`);
  return (data ?? []) as ConnectionRow[];
}

/** Ties an untied key to a project of one of the owner's apps. */
export async function tieConnection(connectionId: string, projectId: string, userId: string): Promise<void> {
  const connection = await connectionForUser(connectionId, userId);
  const { project } = await projectForUser(projectId, userId);
  if (connection.app_project_id) throw new Error("That key is already tied to a project.");
  if (connection.vendor_slug !== project.vendor) throw new Error("That key is for another vendor.");
  const db = getDb();
  const taken = await db.from("connections").select("id").eq("app_project_id", project.id).maybeSingle();
  if (taken.error) throw new Error(`tieConnection: ${taken.error.message}`);
  if (taken.data) throw new Error("That project already has a key. Remove it first, or replace it on the app's Projects page.");
  const { error } = await db.from("connections").update({ app_id: project.app_id, app_project_id: project.id }).eq("id", connection.id);
  if (error) throw new Error(`tieConnection: ${error.message}`);
}

function toKey(row: ProjectConnectionRow, sharedWith: string[]): ProjectKey {
  return {
    id: row.id,
    label: row.label,
    scope: "read",
    fingerprint: row.key_fingerprint ? row.key_fingerprint.slice(0, 6) : null,
    sharedWith,
    lastReadAt: row.last_probed_at,
    lastStatus: row.last_status === "ok" || row.last_status === "failed" ? row.last_status : null,
    lastError: row.last_error,
    createdAt: row.created_at,
  };
}

export function projectLabel(p: Pick<AppProjectRow, "label" | "ref">): string {
  return p.label?.trim() || p.ref;
}

export function toApp(row: AppRow, projects: AppProjectRow[], connections: ProjectConnectionRow[]): App {
  const byProject = new Map(connections.map((c) => [c.app_project_id, c]));
  const out: AppProject[] = projects.map((p) => {
    const c = byProject.get(p.id) ?? null;
    const sharedWith = c?.key_fingerprint
      ? projects.filter((o) => o.id !== p.id && byProject.get(o.id)?.key_fingerprint === c.key_fingerprint).map((o) => `${PROJECT_VENDOR_BY_SLUG.get(o.vendor)?.name ?? o.vendor} ${projectLabel(o)}`)
      : [];
    return {
      id: p.id,
      appId: p.app_id,
      vendor: p.vendor,
      kind: p.kind,
      ref: p.ref,
      label: p.label,
      environment: p.environment,
      plan: p.plan,
      settings: p.settings ?? {},
      dashboardUrl: projectDashboardUrl({ vendor: p.vendor, kind: p.kind, ref: p.ref, settings: p.settings ?? {} }),
      key: c ? toKey(c, sharedWith) : null,
      createdAt: p.created_at,
    };
  });
  const envs = (row.environments ?? []).filter((e): e is Environment => e === "production" || e === "preview" || e === "development");
  return { id: row.id, repoId: row.repo_id, name: row.name, environments: envs.length > 0 ? envs : ["production"], projects: out, createdAt: row.created_at };
}

export function toUntiedKey(row: ConnectionRow): UntiedKey {
  const settings: Record<string, string> = {};
  for (const [k, v] of Object.entries(row.settings ?? {})) if (typeof v === "string") settings[k] = v;
  return {
    id: row.id,
    vendor: row.vendor_slug,
    vendorName: PROJECT_VENDOR_BY_SLUG.get(row.vendor_slug)?.name ?? row.vendor_slug,
    settings,
    lastStatus: row.last_status === "ok" || row.last_status === "failed" ? row.last_status : null,
    lastError: row.last_error,
    createdAt: row.created_at,
  };
}

/**
 * The keys that read a repository's app: each one tied to a project of the
 * app, plus the owner's untied keys from before, which are read the old way
 * (one per vendor) until the owner ties them. Before the migration every key
 * is untied.
 */
export async function keysForRepo(repo: { id: string; owner_user_id: string; full_name: string }): Promise<{ app: AppRow | null; projects: AppProjectRow[]; tied: ProjectConnectionRow[]; untied: ConnectionRow[] }> {
  const app = await ensureAppForRepo(repo);
  const untied = await untiedConnections(repo.owner_user_id);
  if (!app) return { app: null, projects: [], tied: [], untied };
  const [projects, tied] = await Promise.all([projectsForApp(app.id), connectionsForApp(app.id)]);
  return { app, projects, tied, untied };
}
