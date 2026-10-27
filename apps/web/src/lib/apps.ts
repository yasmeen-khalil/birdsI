import {
  addProject,
  appsAvailable,
  connectionsForApp,
  decryptSecret,
  ensureAppForRepo,
  isSecretsKeyConfigured,
  NotReadyError,
  projectForUser,
  projectsForApp,
  removeProject,
  removeProjectKey,
  repoForUser,
  reuseProjectKey,
  saveProjectKey,
  tieConnection,
  toApp,
  toUntiedKey,
  untiedConnections,
  updateApp,
  updateProject,
  type UserRow,
} from "@birdsi/db";
import { CONNECTOR_BY_SLUG, settingsForProject } from "@birdsi/engine";
import { Environment, PROJECT_VENDOR_BY_SLUG, projectProblem, type App, type AppResponse, type ProjectKind } from "@birdsi/shared";
import { ApiError } from "./api";
import { note, ownerAuthor } from "./record";

/**
 * Apps, their vendor projects and the read key tied to each project. Keys
 * are pasted in the browser only and proved against the vendor before they
 * are stored; nothing here ever returns a key.
 */

function notReady(error: unknown): never {
  if (error instanceof NotReadyError) throw new ApiError(503, "not_ready", error.message);
  throw error;
}

/** The app of a repository with its projects and keys, and the owner's keys not tied to a project yet. */
export async function loadApp(repoId: string, user: UserRow): Promise<AppResponse> {
  const repo = await repoForUser(repoId, user.id);
  const untied = (await untiedConnections(user.id)).map(toUntiedKey);
  const row = await ensureAppForRepo(repo);
  if (!row) return { app: null, untiedKeys: untied };
  const [projects, connections] = await Promise.all([projectsForApp(row.id), connectionsForApp(row.id)]);
  return { app: toApp(row, projects, connections), untiedKeys: untied };
}

export async function renameApp(repoId: string, user: UserRow, name: string): Promise<App> {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 80) throw new ApiError(400, "bad_request", "Give the app a name of up to 80 characters.");
  const repo = await repoForUser(repoId, user.id);
  const row = await ensureAppForRepo(repo);
  if (!row) throw new ApiError(503, "not_ready", "Apps switch on when the migration 20261018000100_apps_projects.sql has run.");
  await updateApp(row.id, user.id, { name: trimmed }).catch(notReady);
  await note(repo.id, ownerAuthor(user), { kind: "project", subject: "app", text: `The app is called ${trimmed}.` });
  return (await loadApp(repoId, user)).app!;
}

export async function setEnvironments(repoId: string, user: UserRow, environments: string[]): Promise<void> {
  const parsed = environments.map((e) => Environment.safeParse(e)).filter((r) => r.success).map((r) => r.data);
  if (parsed.length === 0) throw new ApiError(400, "bad_request", "Choose at least one environment.");
  const repo = await repoForUser(repoId, user.id);
  const row = await ensureAppForRepo(repo);
  if (!row) throw new ApiError(503, "not_ready", "Apps switch on when the migration 20261018000100_apps_projects.sql has run.");
  await updateApp(row.id, user.id, { environments: [...new Set(parsed)] }).catch(notReady);
}

export interface ProjectInput {
  vendor: string;
  kind: string;
  ref: string;
  label?: string;
  environment?: string;
  plan?: string;
  settings?: Record<string, string>;
}

function clean(settings: Record<string, string> | undefined, vendor: string): Record<string, string> {
  const allowed = new Set(PROJECT_VENDOR_BY_SLUG.get(vendor)?.settings.map((s) => s.key) ?? []);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(settings ?? {})) if (allowed.has(k) && typeof v === "string" && v.trim()) out[k] = v.trim().slice(0, 200);
  return out;
}

export async function addAppProject(repoId: string, user: UserRow, input: ProjectInput): Promise<void> {
  const settings = clean(input.settings, input.vendor);
  const problem = projectProblem({ vendor: input.vendor, kind: input.kind, ref: input.ref, settings });
  if (problem) throw new ApiError(400, "bad_request", problem);
  const environment = input.environment ? Environment.safeParse(input.environment) : null;
  if (environment && !environment.success) throw new ApiError(400, "bad_request", "Choose production, preview or development, or leave it empty.");
  const repo = await repoForUser(repoId, user.id);
  const row = await ensureAppForRepo(repo);
  if (!row) throw new ApiError(503, "not_ready", "Projects switch on when the migration 20261018000100_apps_projects.sql has run.");
  try {
    await addProject(row.id, user.id, {
      vendor: input.vendor,
      kind: input.kind as ProjectKind,
      ref: input.ref.trim(),
      label: input.label?.trim().slice(0, 60) || null,
      environment: environment?.success ? environment.data : null,
      plan: input.plan?.trim().slice(0, 60) || null,
      settings,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "This app already has that project.") throw new ApiError(409, "exists", error.message);
    notReady(error);
  }
  const vendor = PROJECT_VENDOR_BY_SLUG.get(input.vendor)!;
  await note(repo.id, ownerAuthor(user), { kind: "project", subject: `${input.vendor}:${input.ref.trim()}`, text: `${vendor.name} ${input.kind} ${input.ref.trim()}${input.label ? ` (${input.label.trim()})` : ""} belongs to this app.` });
}

export async function editAppProject(projectId: string, user: UserRow, patch: { label?: string; environment?: string; plan?: string }): Promise<void> {
  const environment = patch.environment === undefined ? undefined : patch.environment === "" ? null : Environment.safeParse(patch.environment);
  if (environment && environment !== null && !environment.success) throw new ApiError(400, "bad_request", "Choose production, preview or development, or leave it empty.");
  await updateProject(projectId, user.id, {
    ...(patch.label !== undefined ? { label: patch.label.trim().slice(0, 60) || null } : {}),
    ...(environment !== undefined ? { environment: environment === null ? null : environment.success ? environment.data : null } : {}),
    ...(patch.plan !== undefined ? { plan: patch.plan.trim().slice(0, 60) || null } : {}),
  }).catch(notReady);
}

export async function removeAppProject(projectId: string, user: UserRow): Promise<void> {
  const { project, app } = await projectForUser(projectId, user.id).catch(notReady);
  await removeProject(projectId, user.id);
  await note(app.repo_id, ownerAuthor(user), { kind: "project", subject: `${project.vendor}:${project.ref}`, text: `Removed ${project.vendor} ${project.kind} ${project.ref} and its key from this app.` });
}

/**
 * Proves a key reads the project, then stores it encrypted. The key is only
 * ever in this request and the worker's memory; the page never sees it again.
 */
export async function connectProjectKey(projectId: string, user: UserRow, input: { token: string; label?: string; settings?: Record<string, string> }): Promise<void> {
  if (!isSecretsKeyConfigured()) throw new ApiError(500, "not_configured", "Keys cannot be stored on this birdsI yet: BIRDSI_SECRETS_KEY is not set.");
  const { project, app } = await projectForUser(projectId, user.id).catch(notReady);
  const vendor = PROJECT_VENDOR_BY_SLUG.get(project.vendor);
  const connector = CONNECTOR_BY_SLUG.get(project.vendor);
  if (!vendor?.reads || !connector) throw new ApiError(400, "bad_request", `birdsI cannot read ${vendor?.name ?? project.vendor} yet, so it holds no key for it. The project stays listed with its dashboard link.`);
  const token = input.token.trim();
  if (token.length < 8) throw new ApiError(400, "bad_request", "Paste the whole key.");
  // Identifiers the key needs (an App Store Connect Key ID, say) come with the key when the project lacks them, and stay with the project. Never a secret.
  let settings = project.settings ?? {};
  const forKey = vendor.settings.filter((s) => s.forKey);
  if (input.settings && forKey.length > 0) {
    const given: Record<string, string> = {};
    for (const s of forKey) {
      const value = (input.settings[s.key] ?? "").trim().slice(0, 200);
      if (value) given[s.key] = value;
    }
    settings = { ...settings, ...given };
    if (Object.keys(given).length > 0) await updateProject(project.id, user.id, { settings });
  }
  try {
    await connector.probe(token, settingsForProject({ vendor: project.vendor, kind: project.kind, ref: project.ref, settings }));
  } catch (error) {
    throw new ApiError(400, "key_rejected", error instanceof Error ? error.message : `${vendor.name} did not accept the key.`);
  }
  await saveProjectKey(project.id, user.id, { vendor: project.vendor, token, label: input.label?.trim().slice(0, 80) || null });
  await note(app.repo_id, ownerAuthor(user), { kind: "project", subject: `${project.vendor}:${project.ref}`, text: `Connected a read key for ${vendor.name} ${project.label ?? project.ref}.` });
}

/** Uses a key the owner already gave birdsI for another project of the same vendor, after proving it reads this one too. */
export async function reuseKeyForProject(projectId: string, user: UserRow, fromConnectionId: string): Promise<void> {
  const { project, app } = await projectForUser(projectId, user.id).catch(notReady);
  const connector = CONNECTOR_BY_SLUG.get(project.vendor);
  const vendor = PROJECT_VENDOR_BY_SLUG.get(project.vendor);
  if (!connector || !vendor?.reads) throw new ApiError(400, "bad_request", "birdsI cannot read this vendor yet.");
  const sources = await connectionsForApp(app.id);
  const source = sources.find((c) => c.id === fromConnectionId);
  if (!source || source.vendor_slug !== project.vendor) throw new ApiError(404, "not_found", "That key is not one of this app's keys for the same vendor.");
  try {
    await connector.probe(decryptSecret(source.token_ciphertext), settingsForProject({ vendor: project.vendor, kind: project.kind, ref: project.ref, settings: project.settings ?? {} }));
  } catch (error) {
    throw new ApiError(400, "key_rejected", `That key does not read this project: ${error instanceof Error ? error.message : "the vendor refused it."}`);
  }
  await reuseProjectKey(project.id, user.id, fromConnectionId);
  await note(app.repo_id, ownerAuthor(user), { kind: "project", subject: `${project.vendor}:${project.ref}`, text: `${vendor.name} ${project.label ?? project.ref} is read with the same key as another project.` });
}

export async function disconnectProjectKey(projectId: string, user: UserRow): Promise<void> {
  const { project, app } = await projectForUser(projectId, user.id).catch(notReady);
  await removeProjectKey(projectId, user.id);
  await note(app.repo_id, ownerAuthor(user), { kind: "project", subject: `${project.vendor}:${project.ref}`, text: `Removed the key for ${project.vendor} ${project.label ?? project.ref}.` });
}

/** Ties a key connected before v3 to one project. */
export async function tieKey(connectionId: string, projectId: string, user: UserRow): Promise<void> {
  try {
    await tieConnection(connectionId, projectId, user.id);
  } catch (error) {
    if (error instanceof Error && /already|another vendor/.test(error.message)) throw new ApiError(409, "conflict", error.message);
    notReady(error);
  }
}

export { appsAvailable };
