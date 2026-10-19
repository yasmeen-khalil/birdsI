import {
  createScan,
  discardScan,
  ensureAppForRepo,
  dependenciesForScan,
  enqueueJob,
  JOB_PRIORITY,
  findingForViewer,
  findingsForScan,
  latestDoneScan,
  localRepoFor,
  repoForUser,
  requestStop,
  scanForViewer,
  setFindingStatus,
  snapshotForUser,
  toFinding,
  toScan,
  type UserRow,
  policyForRepo,
} from "@birdsi/db";
import type { CreateScanRequest, FindingResponse, ScanResponse } from "@birdsi/shared";
import { ApiError } from "./api";
import { assertUserScanQuota, firstActiveScanForRepo, runningScanForRepo } from "./limits";
import { note, ownerAuthor, type RecordAuthor } from "./record";

/**
 * Map and finding operations shared by the web pages and /api/v1. Every
 * function takes the acting user and enforces ownership through the db layer.
 */
export async function startScan(user: UserRow, input: CreateScanRequest, source: "web" | "cli" | "mcp"): Promise<ScanResponse["scan"]> {
  if (!input.repoId && !input.snapshotId) throw new ApiError(400, "bad_request", "Choose a connected repository or upload a snapshot first.");
  await assertUserScanQuota(user.id);
  let branch = input.branch ?? null;
  let repoId = input.repoId ?? null;
  if (input.repoId) {
    const repo = await repoForUser(input.repoId, user.id);
    branch = branch ?? repo.default_branch;
  }
  if (input.snapshotId) {
    const snap = await snapshotForUser(input.snapshotId, user.id);
    if (!snap.uploaded_at) throw new ApiError(400, "bad_request", "The snapshot upload has not completed.");
    branch = branch ?? snap.branch;
    // A snapshot from the terminal belongs to a local repository, so everything
    // (findings, vendors, questions, the record) accumulates under one place.
    if (!repoId) {
      const name = snap.full_name?.trim() || `local/${input.snapshotId.slice(0, 8)}`;
      const repo = await localRepoFor(user.id, name, branch);
      repoId = repo.id;
      // Every repository is an app, from its first map on.
      await ensureAppForRepo(repo);
    }
  }
  if (repoId) {
    const running = await runningScanForRepo(repoId);
    if (running) throw new ApiError(409, "already_running", "A map of this app is already running. Wait for it to finish or stop it first.");
  }
  const scan = await createScan({ repoId, snapshotId: input.snapshotId ?? null, ownerUserId: user.id, source, branch });
  if (repoId && (await firstActiveScanForRepo(repoId)) !== scan.id) {
    // Another request queued a map of this repository at the same moment; that one runs.
    await discardScan(scan.id);
    throw new ApiError(409, "already_running", "A map of this app is already running. Wait for it to finish or stop it first.");
  }
  // One attempt: a retry would pay for the docs check again.
  await enqueueJob("scan", { scanId: scan.id }, { maxAttempts: 1, priority: JOB_PRIORITY.interactive });
  return toScan(scan);
}

export async function loadScan(scanId: string, user: UserRow | null): Promise<ScanResponse> {
  const scan = await scanForViewer(scanId, user?.id ?? null);
  const [findings, dependencies] = await Promise.all([findingsForScan(scanId), dependenciesForScan(scanId)]);
  return { scan: toScan(scan), findings: findings.map(toFinding), dependencies };
}

export async function loadLatestScan(repoId: string, user: UserRow): Promise<ScanResponse | null> {
  await repoForUser(repoId, user.id);
  const latest = await latestDoneScan(repoId);
  if (!latest) return null;
  return loadScan(latest.id, user);
}

export async function stopScan(scanId: string, user: UserRow | null): Promise<void> {
  const scan = await scanForViewer(scanId, user?.id ?? null);
  if (scan.status !== "queued" && scan.status !== "running") return;
  await requestStop(scanId);
}

export async function loadFinding(findingId: string, user: UserRow | null): Promise<FindingResponse> {
  const { finding } = await findingForViewer(findingId, user?.id ?? null);
  return { finding: toFinding(finding) };
}

export async function dismissFinding(findingId: string, user: UserRow, author: RecordAuthor = ownerAuthor(user)): Promise<void> {
  const { finding } = await findingForViewer(findingId, user.id);
  await setFindingStatus(finding.id, finding.repo_id, finding.key, "dismissed");
  await note(finding.repo_id, author, { kind: "finding_dismissed", subject: finding.key, text: finding.title, data: { findingId: finding.id } });
}

export async function reopenFinding(findingId: string, user: UserRow, author: RecordAuthor = ownerAuthor(user)): Promise<void> {
  const { finding } = await findingForViewer(findingId, user.id);
  await setFindingStatus(finding.id, finding.repo_id, finding.key, "open");
  await note(finding.repo_id, author, { kind: "finding_reopened", subject: finding.key, text: finding.title, data: { findingId: finding.id } });
}

/**
 * The writer says the finding is fixed in the code. The mark is recorded with
 * its author; the next scan is the judge and reopens the finding if it is
 * still there. Agents need the repo's policy to allow writes.
 */
export async function markFindingFixed(findingId: string, user: UserRow, noteText: string | null, author: RecordAuthor): Promise<void> {
  const { finding } = await findingForViewer(findingId, user.id);
  if (author.kind === "agent" && finding.repo_id) {
    const policy = await policyForRepo(finding.repo_id);
    if (!policy.allowWrite) throw new ApiError(403, "policy", "Agents may not write to the record in this repository. The owner can allow it on the Agent page.");
  }
  await setFindingStatus(finding.id, finding.repo_id, finding.key, "fixed");
  await note(finding.repo_id, author, { kind: "finding_fixed", subject: finding.key, text: finding.title, why: noteText, data: { findingId: finding.id } });
}
