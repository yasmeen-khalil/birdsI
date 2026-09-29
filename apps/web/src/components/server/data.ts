import { redirect } from "next/navigation";
import { cache } from "react";
import { eventsAfter, latestDoneScan, repoForUser, reposForUser, scansForRepo, toScan, type RepoRow, type UserRow } from "@birdsi/db";
import type { ScanEvent, Scan } from "@birdsi/shared";
import { currentUserRow } from "@/lib/auth";
import { orNotFound, requireId } from "../guard";
import type { RepoOption } from "../shell/RepoSwitcher";

/** Server-side reads shared by the app's layouts and pages. Cached per request. */

export const appUser = cache(async (): Promise<UserRow> => {
  const user = await currentUserRow();
  if (!user) redirect("/sign-in");
  return user;
});

export const userRepos = cache(async (userId: string): Promise<RepoRow[]> => reposForUser(userId));

export function toOption(r: RepoRow): RepoOption {
  return { id: r.id, fullName: r.full_name, defaultBranch: r.default_branch };
}

export const repoContext = cache(async (rawRepoId: string): Promise<{ user: UserRow; repo: RepoRow }> => {
  const repoId = requireId(rawRepoId);
  const user = await appUser();
  const repo = await orNotFound(repoForUser(repoId, user.id));
  if (repo.archived_at) redirect("/app");
  return { user, repo };
});

export const recentScans = cache(async (repoId: string): Promise<Scan[]> => (await scansForRepo(repoId, 12)).map(toScan));

export const latestDone = cache(async (repoId: string): Promise<Scan | null> => {
  const row = await latestDoneScan(repoId);
  return row ? toScan(row) : null;
});

/** The folder map a scan recorded when it listed the repository. */
export async function inventoryOf(scanId: string): Promise<Extract<ScanEvent, { type: "inventory" }> | null> {
  const events = await eventsAfter(scanId, 0, 20);
  const found = events.map((e) => e.event).find((e) => e.type === "inventory");
  return found && found.type === "inventory" ? found : null;
}

export function runningOf(scans: Scan[]): Scan | null {
  return scans.find((s) => s.status === "queued" || s.status === "running") ?? null;
}
