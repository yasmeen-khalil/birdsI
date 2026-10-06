import {
  allowDemo,
  appendChat,
  chatHistory,
  chunksForRepo,
  createFix,
  createScan,
  dependenciesForScan,
  enqueueJob,
  JOB_PRIORITY,
  findingForViewer,
  findingsForScan,
  latestDemoScanId,
  latestDoneDemoScan,
  latestDoneScan,
  latestFixForFinding,
  localRepoFor,
  matchChunks,
  recordUsage,
  repoForUser,
  requestStop,
  scanForViewer,
  setFindingStatus,
  snapshotForUser,
  toFinding,
  toFix,
  toScan,
  type UserRow,
  policyForRepo,
} from "@birdsi/db";
import { answerQuestion, loadEngineConfig, ModelClient } from "@birdsi/engine";
import type { ChatMessage, CreateScanRequest, FindingResponse, ScanResponse } from "@birdsi/shared";
import { ApiError } from "./api";
import { envInt } from "./env";
import { assertSpendCap, assertUserScanQuota, assertUserSpendCap, runningScanForRepo } from "./limits";
import { loadInventory } from "./ops";
import { note, ownerAuthor, type RecordAuthor } from "./record";

/**
 * Scan and fix operations shared by the web pages and /api/v1. Every
 * function takes the acting user and enforces ownership through the db layer.
 */
export async function startScan(user: UserRow, input: CreateScanRequest, source: "web" | "cli" | "mcp"): Promise<ScanResponse["scan"]> {
  if (!input.repoId && !input.snapshotId) throw new ApiError(400, "bad_request", "Choose a connected repository or upload a snapshot first.");
  await assertSpendCap();
  await assertUserSpendCap(user.id);
  await assertUserScanQuota(user.id, input.kind);
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
    // (findings, vendors, questions, chat) accumulates under one place.
    if (!repoId) {
      const name = snap.full_name?.trim() || `local/${input.snapshotId.slice(0, 8)}`;
      repoId = (await localRepoFor(user.id, name, branch)).id;
    }
  }
  if (repoId) {
    const running = await runningScanForRepo(repoId);
    if (running) throw new ApiError(409, "already_running", "A scan of this repository is already running. Wait for it to finish or stop it first.");
  }
  const scan = await createScan({ repoId, snapshotId: input.snapshotId ?? null, ownerUserId: user.id, kind: input.kind, source, branch, appDescription: input.appDescription ?? null });
  await enqueueJob("scan", { scanId: scan.id }, { priority: input.kind === "light" ? JOB_PRIORITY.interactive : JOB_PRIORITY.background });
  return toScan(scan);
}

/** A demo scan for a visitor. Rate limited; over the limit, the newest finished demo is shown instead. */
export async function startDemoScan(clientKey: string): Promise<{ scanId: string; reused: boolean }> {
  // A finished demo from the last six hours is the demo: the sample does not change, so a fresh run would only spend credits.
  const recent = await latestDoneDemoScan();
  if (recent && Date.now() - new Date(recent.created_at).getTime() < 6 * 3_600_000) return { scanId: recent.id, reused: true };
  const allowed = await allowDemo(clientKey, { perClientPerHour: envInt("BIRDSI_DEMO_PER_CLIENT_PER_HOUR", 3), globalPerHour: envInt("BIRDSI_DEMO_GLOBAL_PER_HOUR", 30) });
  let capacity = true;
  try {
    await assertSpendCap();
  } catch {
    capacity = false;
  }
  if (!allowed.allowed || !capacity) {
    const latest = await latestDemoScanId();
    if (latest) return { scanId: latest, reused: true };
    throw new ApiError(429, "capacity", "The sample scan is busy right now. Try again in a few minutes.");
  }
  const scan = await createScan({ repoId: null, snapshotId: null, ownerUserId: null, kind: "light", source: "demo", branch: "main", appDescription: "Online ordering for a neighbourhood bakery: menu, basket, card checkout with Stripe, order history, and a staff dashboard." });
  await enqueueJob("scan", { scanId: scan.id }, { maxAttempts: 1, priority: JOB_PRIORITY.interactive });
  return { scanId: scan.id, reused: false };
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
  const fix = await latestFixForFinding(finding.id);
  return { finding: toFinding(finding), fix: fix ? toFix(fix) : null };
}

export async function startFix(findingId: string, user: UserRow): Promise<FindingResponse["fix"]> {
  const { finding, scan } = await findingForViewer(findingId, user.id);
  if (scan.source === "demo") throw new ApiError(403, "demo", "The sample repository is read-only. Sign in and connect your own to open pull requests.");
  if (finding.action_kind !== "fix") throw new ApiError(400, "not_fixable", "This finding needs an action from you rather than a code change.");
  const existing = await latestFixForFinding(finding.id);
  if (existing && (existing.status === "proposed" || existing.status === "testing")) return toFix(existing);
  if (existing && existing.status === "pr_open") return toFix(existing);
  await assertSpendCap();
  await assertUserSpendCap(user.id);
  const fix = await createFix(finding.id, user.id);
  await note(finding.repo_id, ownerAuthor(user), { kind: "fix_opened", subject: finding.key, text: finding.title, data: { findingId: finding.id, fixId: fix.id } });
  await enqueueJob("fix", { fixId: fix.id }, { maxAttempts: 1, priority: JOB_PRIORITY.fix });
  return toFix(fix);
}

export async function dismissFinding(findingId: string, user: UserRow, author: RecordAuthor = ownerAuthor(user)): Promise<void> {
  const { finding, scan } = await findingForViewer(findingId, user.id);
  if (scan.source === "demo") throw new ApiError(403, "demo", "The sample repository is read-only.");
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
  const { finding, scan } = await findingForViewer(findingId, user.id);
  if (scan.source === "demo") throw new ApiError(403, "demo", "The sample repository is read-only.");
  if (author.kind === "agent" && finding.repo_id) {
    const policy = await policyForRepo(finding.repo_id);
    if (!policy.allowWrite) throw new ApiError(403, "policy", "Agents may not write to the record in this repository. The owner can allow it on the Agent page.");
  }
  await setFindingStatus(finding.id, finding.repo_id, finding.key, "fixed");
  await note(finding.repo_id, author, { kind: "finding_fixed", subject: finding.key, text: finding.title, why: noteText, data: { findingId: finding.id } });
}

export async function askRepo(repoId: string, user: UserRow, question: string): Promise<ChatMessage> {
  const repo = await repoForUser(repoId, user.id);
  const trimmed = question.trim();
  if (trimmed.length === 0) throw new ApiError(400, "bad_request", "Ask a question first.");
  if (trimmed.length > 2000) throw new ApiError(400, "bad_request", "Keep questions under 2,000 characters.");
  await assertSpendCap();
  await assertUserSpendCap(user.id);
  const config = loadEngineConfig();
  const latest = await latestDoneScan(repo.id);
  const findings = latest ? (await findingsForScan(latest.id)).map(toFinding) : [];
  const history = await chatHistory(repo.id, user.id, 12);
  await appendChat(repo.id, user.id, { role: "user", content: trimmed, citations: [], judgment: false });

  // Retrieval: vector search when embeddings exist, otherwise keyword ranking over stored chunks.
  let chunks: Array<{ path: string; lineStart: number; lineEnd: number; text: string }> = [];
  try {
    const models = new ModelClient(config);
    const [vector] = await models.embed([trimmed], "chat");
    if (vector) chunks = (await matchChunks(repo.id, vector, 12)).map((c) => ({ path: c.path, lineStart: c.line_start, lineEnd: c.line_end, text: c.text }));
  } catch {
    // Embeddings unavailable; fall through to keywords.
  }
  if (chunks.length === 0) chunks = (await chunksForRepo(repo.id)).map((c) => ({ path: c.path, lineStart: c.line_start, lineEnd: c.line_end, text: c.text }));

  let projectSummary = "";
  try {
    const inv = await loadInventory(repo.id, user);
    projectSummary = [
      inv.vision.text ? `Vision: ${inv.vision.text.slice(0, 600)}` : "Vision: not written yet.",
      `Vendors (${inv.vendors.length}): ${inv.vendors.map((v) => `${v.name}${v.facts.find((f) => f.kind === "plan") ? ` (${v.facts.find((f) => f.kind === "plan")!.value})` : ""}`).join(", ") || "none found yet"}`,
      `Alerts: ${inv.alerts.map((a) => `[${a.level}] ${a.title}`).join("; ") || "none"}`,
      `Tracking: ${inv.watches.map((w) => `${w.vendorName}: ${w.title}`).join("; ") || "nothing"}`,
      `Stages: ${inv.stages.map((s) => `${s.label} ${s.freshness}`).join(", ")}`,
      `Open questions for the owner: ${inv.openQuestions}. Pending approvals: ${inv.pendingActions}.`,
      inv.latestScan ? `Latest scan: ${inv.latestScan.kind}, ${inv.latestScan.findings} open findings.` : "No scan has finished yet.",
    ].join("\n");
  } catch {
    // The summary is a help, not a requirement.
  }
  const answer = await answerQuestion(config, {
    question: trimmed,
    history: history.map((m) => ({ role: m.role, content: m.content })),
    chunks,
    findings,
    repoName: repo.full_name,
    projectSummary,
    onUsage: (u) => recordUsage({ ownerUserId: user.id, scanId: latest?.id ?? null, fixId: null, purpose: u.purpose, model: u.model, inputTokens: u.inputTokens, outputTokens: u.outputTokens, costMicrodollars: u.costMicrodollars }),
  });
  const citations = answer.citations.map((c) => ({
    label: c.label,
    ...(c.path ? { path: c.path } : {}),
    ...(c.lineStart ? { lineStart: c.lineStart } : {}),
    ...(c.findingId ? { findingId: c.findingId } : {}),
  }));
  return appendChat(repo.id, user.id, { role: "assistant", content: answer.answer, citations, judgment: answer.judgment });
}
