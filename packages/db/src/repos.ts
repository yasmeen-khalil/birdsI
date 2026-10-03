import type { Repo } from "@birdsi/shared";
import { ForbiddenError, getDb, NotFoundError, unwrap } from "./client";

export interface RepoRow {
  id: string;
  installation_id: string | null;
  github_repo_id: number | null;
  full_name: string;
  default_branch: string;
  private: boolean;
  owner_user_id: string;
  source: "github" | "local";
  vision: string | null;
  vision_updated_at: string | null;
  vendors_synced_at: string | null;
  archived_at: string | null;
  created_at: string;
}

export interface InstallationRow {
  id: string;
  github_installation_id: number;
  account_login: string;
  account_type: string;
  connected_by: string | null;
  suspended_at: string | null;
  removed_at: string | null;
  created_at: string;
}

export function toRepo(row: RepoRow): Repo {
  return { id: row.id, fullName: row.full_name, defaultBranch: row.default_branch, private: row.private, installationId: row.installation_id, source: row.source ?? "github", createdAt: row.created_at };
}

/**
 * A repository uploaded by the terminal tool. One per owner and name; the
 * name is the GitHub remote when there is one, otherwise the folder name.
 * Everything a GitHub-connected repository has (findings, chat, vendors,
 * questions) hangs off it the same way.
 */
export async function localRepoFor(ownerUserId: string, fullName: string, branch: string | null): Promise<RepoRow> {
  const db = getDb();
  const { data, error } = await db.from("repos").select().eq("owner_user_id", ownerUserId).eq("full_name", fullName).is("github_repo_id", null).is("archived_at", null).maybeSingle();
  if (error) throw new Error(`localRepoFor: ${error.message}`);
  if (data) return data as RepoRow;
  const result = await db
    .from("repos")
    .insert({ owner_user_id: ownerUserId, installation_id: null, github_repo_id: null, full_name: fullName, default_branch: branch ?? "main", private: true, source: "local" })
    .select()
    .single();
  return unwrap(result, "localRepoFor") as RepoRow;
}

export async function upsertInstallation(input: { githubInstallationId: number; accountLogin: string; accountType: string; connectedBy: string | null }): Promise<InstallationRow> {
  const db = getDb();
  const result = await db
    .from("installations")
    .upsert(
      { github_installation_id: input.githubInstallationId, account_login: input.accountLogin, account_type: input.accountType, connected_by: input.connectedBy ?? undefined, suspended_at: null, removed_at: null },
      { onConflict: "github_installation_id" },
    )
    .select()
    .single();
  return unwrap(result, "upsertInstallation") as InstallationRow;
}

export async function installationByGithubId(githubInstallationId: number): Promise<InstallationRow | null> {
  const db = getDb();
  const { data, error } = await db.from("installations").select().eq("github_installation_id", githubInstallationId).maybeSingle();
  if (error) throw new Error(`installationByGithubId: ${error.message}`);
  return (data as InstallationRow | null) ?? null;
}

export async function markInstallation(githubInstallationId: number, patch: { suspended?: boolean; removed?: boolean }): Promise<void> {
  const db = getDb();
  const update: Record<string, unknown> = {};
  if (patch.suspended !== undefined) update["suspended_at"] = patch.suspended ? new Date().toISOString() : null;
  if (patch.removed) update["removed_at"] = new Date().toISOString();
  const { error } = await db.from("installations").update(update).eq("github_installation_id", githubInstallationId);
  if (error) throw new Error(`markInstallation: ${error.message}`);
  if (patch.removed) {
    const inst = await installationByGithubId(githubInstallationId);
    if (inst) {
      const { error: repoError } = await db.from("repos").update({ archived_at: new Date().toISOString() }).eq("installation_id", inst.id).is("archived_at", null);
      if (repoError) throw new Error(`markInstallation repos: ${repoError.message}`);
    }
  }
}

export async function installationsForUser(userId: string): Promise<InstallationRow[]> {
  const db = getDb();
  const { data, error } = await db.from("installations").select().eq("connected_by", userId).is("removed_at", null).order("created_at");
  if (error) throw new Error(`installationsForUser: ${error.message}`);
  return (data ?? []) as InstallationRow[];
}

export async function connectRepo(input: { ownerUserId: string; installationId: string; githubRepoId: number; fullName: string; defaultBranch: string; private: boolean }): Promise<RepoRow> {
  const db = getDb();
  const result = await db
    .from("repos")
    .upsert(
      { owner_user_id: input.ownerUserId, installation_id: input.installationId, github_repo_id: input.githubRepoId, full_name: input.fullName, default_branch: input.defaultBranch, private: input.private, archived_at: null },
      { onConflict: "github_repo_id" },
    )
    .select()
    .single();
  return unwrap(result, "connectRepo") as RepoRow;
}

export async function reposForUser(userId: string): Promise<RepoRow[]> {
  const db = getDb();
  const { data, error } = await db.from("repos").select().eq("owner_user_id", userId).is("archived_at", null).order("full_name");
  if (error) throw new Error(`reposForUser: ${error.message}`);
  return (data ?? []) as RepoRow[];
}

/** Loads a repo and proves the caller owns it. Missing and forbidden look the same to the caller. */
export async function repoForUser(repoId: string, userId: string): Promise<RepoRow> {
  const db = getDb();
  const { data, error } = await db.from("repos").select().eq("id", repoId).maybeSingle();
  if (error) throw new Error(`repoForUser: ${error.message}`);
  const row = data as RepoRow | null;
  if (!row || row.archived_at) throw new NotFoundError("repo");
  if (row.owner_user_id !== userId) throw new ForbiddenError("repo");
  return row;
}

export async function repoByGithubId(githubRepoId: number): Promise<RepoRow | null> {
  const db = getDb();
  const { data, error } = await db.from("repos").select().eq("github_repo_id", githubRepoId).maybeSingle();
  if (error) throw new Error(`repoByGithubId: ${error.message}`);
  return (data as RepoRow | null) ?? null;
}

/**
 * Disconnecting is the user's explicit request to forget the repository:
 * scans, findings, chat and chunks cascade away. Ledger rows keep their
 * scan reference set to null so cost history stays true.
 */
export async function deleteRepo(repoId: string, userId: string): Promise<void> {
  await repoForUser(repoId, userId);
  const db = getDb();
  const { error } = await db.from("repos").delete().eq("id", repoId);
  if (error) throw new Error(`deleteRepo: ${error.message}`);
}

export async function repoWithInstallation(repoId: string): Promise<{ repo: RepoRow; installation: InstallationRow | null }> {
  const db = getDb();
  const { data, error } = await db.from("repos").select().eq("id", repoId).maybeSingle();
  if (error) throw new Error(`repoWithInstallation: ${error.message}`);
  const repo = data as RepoRow | null;
  if (!repo) throw new NotFoundError("repo");
  let installation: InstallationRow | null = null;
  if (repo.installation_id) {
    const inst = await db.from("installations").select().eq("id", repo.installation_id).maybeSingle();
    if (inst.error) throw new Error(`repoWithInstallation: ${inst.error.message}`);
    installation = (inst.data as InstallationRow | null) ?? null;
  }
  return { repo, installation };
}
