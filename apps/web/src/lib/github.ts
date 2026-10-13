import { createHmac, timingSafeEqual } from "node:crypto";
import { connectRepo, installationByGithubId, markInstallation, upsertInstallation, type UserRow } from "@birdsi/db";
import { GitHubSource, loadEngineConfig } from "@birdsi/engine";
import { env } from "./env";

const STATE_MAX_AGE_MS = 24 * 3_600_000;

function stateKey(): string | null {
  return env("GITHUB_WEBHOOK_SECRET") ?? env("GITHUB_APP_PRIVATE_KEY");
}

function stateSignature(userId: string, issuedAt: string, key: string): string {
  return createHmac("sha256", key).update(`github-install:${userId}:${issuedAt}`).digest("base64url");
}

/** A signed value naming the user who started the install; GitHub hands it back on the setup redirect. */
export function installState(userId: string): string | null {
  const key = stateKey();
  if (!key) return null;
  const issuedAt = String(Date.now());
  return `${issuedAt}.${stateSignature(userId, issuedAt, key)}`;
}

/** True when the state was issued to this user by this server within the last day. */
export function verifyInstallState(state: string | null, userId: string): boolean {
  const key = stateKey();
  if (!key || !state) return false;
  const [issuedAt, signature] = state.split(".");
  if (!issuedAt || !signature || !/^\d{1,15}$/.test(issuedAt)) return false;
  const age = Date.now() - Number(issuedAt);
  if (age < 0 || age > STATE_MAX_AGE_MS) return false;
  const a = Buffer.from(stateSignature(userId, issuedAt, key));
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function installUrl(userId: string): string | null {
  const slug = env("GITHUB_APP_SLUG");
  const state = installState(userId);
  if (!slug || !state) return null;
  return `https://github.com/apps/${slug}/installations/new?state=${encodeURIComponent(state)}`;
}

/** The installation is already tied to another birdsI account; nothing is changed. */
export class InstallationTakenError extends Error {
  override name = "InstallationTakenError";
}

/** Verifies the X-Hub-Signature-256 header GitHub sends with every webhook. */
export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  const secret = env("GITHUB_WEBHOOK_SECRET");
  if (!secret || !signature) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * After the install redirect: records the installation for this user and
 * connects every repository it grants. The installation id comes from the
 * GitHub redirect, and is verified against the App API before use.
 */
export async function completeInstallation(user: UserRow, installationId: number): Promise<{ connected: number; accountLogin: string }> {
  const config = loadEngineConfig();
  const github = new GitHubSource(config);
  // Proves the installation exists and belongs to this app before anything is stored.
  const info = await github.installationInfo(installationId);
  const repos = await github.listRepos(installationId);
  // An installation belongs to the account that connected it first. The id in the redirect
  // is only a number, so it never moves an installation or its repositories to someone else.
  const existing = await installationByGithubId(installationId);
  if (existing?.connected_by && existing.connected_by !== user.id) throw new InstallationTakenError(`installation ${installationId} is connected to another account`);
  const installation = await upsertInstallation({ githubInstallationId: installationId, accountLogin: info.accountLogin, accountType: info.accountType, connectedBy: user.id });
  const accountLogin = info.accountLogin;
  let connected = 0;
  for (const repo of repos) {
    const row = await connectRepo({ ownerUserId: user.id, installationId: installation.id, githubRepoId: repo.id, fullName: repo.fullName, defaultBranch: repo.defaultBranch, private: repo.private });
    if (row) connected += 1;
  }
  return { connected, accountLogin };
}

interface InstallationEvent {
  action: string;
  installation: { id: number; account: { login: string; type: string } };
  repositories?: Array<{ id: number; full_name: string; private: boolean }>;
  repositories_added?: Array<{ id: number; full_name: string; private: boolean }>;
  repositories_removed?: Array<{ id: number; full_name: string }>;
}

/** Keeps installations and repositories in step with what happens on GitHub. */
export async function handleWebhook(event: string, payload: InstallationEvent): Promise<void> {
  if (event === "installation") {
    if (payload.action === "deleted") await markInstallation(payload.installation.id, { removed: true });
    else if (payload.action === "suspend") await markInstallation(payload.installation.id, { suspended: true });
    else if (payload.action === "unsuspend") await markInstallation(payload.installation.id, { suspended: false });
    else if (payload.action === "created") {
      // The user completes this through the setup redirect; nothing to own yet.
      await upsertInstallation({ githubInstallationId: payload.installation.id, accountLogin: payload.installation.account.login, accountType: payload.installation.account.type, connectedBy: null });
    }
    return;
  }
  if (event === "installation_repositories") {
    const installation = await installationByGithubId(payload.installation.id);
    if (!installation || !installation.connected_by) return;
    const config = loadEngineConfig();
    if (payload.repositories_added?.length && GitHubSource.isConfigured(config)) {
      const github = new GitHubSource(config);
      const live = await github.listRepos(payload.installation.id);
      for (const added of payload.repositories_added) {
        const details = live.find((r) => r.id === added.id);
        await connectRepo({ ownerUserId: installation.connected_by, installationId: installation.id, githubRepoId: added.id, fullName: added.full_name, defaultBranch: details?.defaultBranch ?? "main", private: added.private });
      }
    }
    if (payload.repositories_removed?.length) {
      const { getDb } = await import("@birdsi/db");
      const db = getDb();
      await db
        .from("repos")
        .update({ archived_at: new Date().toISOString() })
        .in(
          "github_repo_id",
          payload.repositories_removed.map((r) => r.id),
        );
    }
  }
}
