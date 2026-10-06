import {
  actionById,
  actionsForRepo,
  answerQuestionRow,
  askQuestion,
  connectionsForUser,
  createActionRequest,
  decideAction,
  deleteConnection,
  enqueueJob,
  factHistory,
  factsForVendors,
  findingsForScan,
  isSecretsKeyConfigured,
  scanForViewer,
  jobActive,
  knowledgeFor,
  latestDoneScan,
  policyForRepo,
  questionById,
  questionsForRepo,
  repoForUser,
  reportAction,
  saveConnection,
  scansForRepo,
  setVision,
  toAction,
  toQuestion,
  toVendor,
  updatePolicy,
  upsertFact,
  vendorBySlug,
  vendorsForRepo,
  visionForRepo,
  type UserRow,
} from "@birdsi/db";
import { computeAlerts, computeRunway, computeWatches, CONNECTOR_BY_SLUG, connectorInfo, monthlySpend, stageStates } from "@birdsi/engine";
import { diffFindings } from "@birdsi/shared";
import type { ActionRequest, ActionsResponse, AskOwnerRequest, ChangesResponse, InventoryResponse, Question, RequestActionRequest, UpdatePolicyRequest, Vendor, VendorsResponse, Vision } from "@birdsi/shared";
import { ALLOWED_COMMANDS, isAllowedCommand } from "@birdsi/shared";
import { ApiError } from "./api";
import { assertSpendCap, assertUserSpendCap } from "./limits";

/**
 * The operations layer: vendors and their facts, alerts, the pipeline
 * stages, questions, action requests, the agent policy and the vision.
 * Shared by the web pages, /api/v1 and therefore the CLI and MCP server.
 */

export async function loadVendors(repoId: string, user: UserRow): Promise<VendorsResponse> {
  const repo = await repoForUser(repoId, user.id);
  const [rows, connections, scans] = await Promise.all([vendorsForRepo(repo.id), connectionsForUser(user.id), scansForRepo(repo.id, 12)]);
  const facts = await factsForVendors(rows.map((r) => r.id));
  const knowledge = await knowledgeFor(rows.map((r) => r.slug));
  const connected = new Set(connections.map((c) => c.vendor_slug));
  const errors = new Map(connections.filter((c) => c.last_status === "failed" && c.last_error).map((c) => [c.vendor_slug, c.last_error!]));
  const vendors: Vendor[] = rows.map((r) => {
    const v = toVendor(r, facts.filter((f) => f.vendor_id === r.id), connected.has(r.slug));
    const k = knowledge.get(r.slug);
    if (k && (!v.what || v.what.trim() === "")) v.what = k.what;
    if (k && !v.pricingUrl) v.pricingUrl = k.pricingUrl;
    return v;
  });
  const history = await factHistory(rows.map((r) => r.id));
  const runways: Record<string, ReturnType<typeof computeRunway>> = {};
  const runwayMap = new Map<string, ReturnType<typeof computeRunway>>();
  for (const v of vendors) {
    const r = computeRunway(history.get(v.id) ?? [], new Map(v.facts.map((f) => [f.metric, f.label])));
    if (r.length > 0) runways[v.id] = r;
    runwayMap.set(v.id, r);
  }
  const alerts = computeAlerts(vendors, knowledge, errors, runwayMap);
  const watches = computeWatches(vendors, knowledge);
  const running = scans.some((s) => s.status === "queued" || s.status === "running");
  const latestDone = scans.find((s) => s.status === "done") ?? null;
  const latestAudit = scans.find((s) => s.status === "done" && (s.kind === "deep" || s.kind === "audit")) ?? null;
  const syncRunning = await jobActive("vendor_sync", "repoId", repo.id);
  const stages = stageStates({
    lastScanAt: latestDone?.finished_at ?? null,
    lastScanRunning: running,
    lastDocsAt: latestDone?.finished_at ?? null,
    lastAuditAt: latestAudit?.finished_at ?? null,
    lastOpsAt: repo.vendors_synced_at,
    opsRunning: syncRunning,
  });
  return { vendors, alerts, watches, runways, stages, monthlyUsd: monthlySpend(vendors, knowledge), syncRunning, lastSyncAt: repo.vendors_synced_at };
}

/** Starts the ops stage alone. Needs a finished scan first, because vendors come from the scan. */
export async function startVendorSync(repoId: string, user: UserRow): Promise<{ queued: boolean; reason?: string }> {
  const repo = await repoForUser(repoId, user.id);
  const latest = await latestDoneScan(repo.id);
  if (!latest) return { queued: false, reason: "Run a scan first: the vendor list comes from the code." };
  if (await jobActive("vendor_sync", "repoId", repo.id)) return { queued: false, reason: "A vendor refresh is already running." };
  await assertSpendCap();
  await assertUserSpendCap(user.id);
  await enqueueJob("vendor_sync", { repoId: repo.id, ownerUserId: user.id, hints: null }, { maxAttempts: 1 });
  return { queued: true };
}

export async function loadQuestions(repoId: string, user: UserRow, status?: Question["status"]): Promise<Question[]> {
  const repo = await repoForUser(repoId, user.id);
  const [rows, vendors] = await Promise.all([questionsForRepo(repo.id, status), vendorsForRepo(repo.id)]);
  const names = new Map(vendors.map((v) => [v.id, v.name]));
  return rows.map((r) => toQuestion(r, r.vendor_id ? (names.get(r.vendor_id) ?? null) : null));
}

export async function answerQuestion(questionId: string, user: UserRow, answer: string): Promise<Question> {
  const row = await questionById(questionId);
  if (!row) throw new ApiError(404, "not_found", "Not found.");
  await repoForUser(row.repo_id, user.id);
  if (row.status !== "open") throw new ApiError(409, "closed", "This question is already answered.");
  const trimmed = answer.trim();
  if (!trimmed) throw new ApiError(400, "bad_request", "Write an answer first.");
  const updated = await answerQuestionRow(row.id, trimmed, "answered");
  if (row.vendor_id && row.updates) {
    const numeric = Number(trimmed.replace(/[^0-9.]/g, ""));
    await upsertFact(row.vendor_id, {
      kind: row.updates.kind,
      metric: row.updates.metric,
      label: row.updates.label,
      value: trimmed,
      numeric: row.updates.kind === "usage" || row.updates.kind === "limit" || row.updates.kind === "cost" ? (Number.isFinite(numeric) && trimmed.replace(/[^0-9.]/g, "") !== "" ? numeric : null) : null,
      unit: row.updates.unit,
      limitNumeric: null,
      source: "asked",
      evidence: { note: `Answered by the owner on ${new Date().toISOString().slice(0, 10)}.` },
    });
    if (row.updates.kind === "plan") {
      // A new plan means new limits: refresh the ops stage.
      await enqueueJob("vendor_sync", { repoId: row.repo_id, ownerUserId: user.id, hints: null }, { maxAttempts: 1 }).catch(() => undefined);
    }
  }
  const vendors = await vendorsForRepo(row.repo_id);
  return toQuestion(updated, row.vendor_id ? (vendors.find((v) => v.id === row.vendor_id)?.name ?? null) : null);
}

export async function dismissQuestion(questionId: string, user: UserRow): Promise<void> {
  const row = await questionById(questionId);
  if (!row) throw new ApiError(404, "not_found", "Not found.");
  await repoForUser(row.repo_id, user.id);
  await answerQuestionRow(row.id, null, "dismissed");
}

/** An agent asks the owner something only a person can answer. */
export async function askOwner(repoId: string, user: UserRow, input: AskOwnerRequest): Promise<Question> {
  const repo = await repoForUser(repoId, user.id);
  const policy = await policyForRepo(repo.id);
  if (!policy.allowPropose) throw new ApiError(403, "policy", "Agents may not ask questions in this repository. The owner can allow it on the Agent page.");
  const vendor = input.vendorSlug ? await vendorBySlug(repo.id, input.vendorSlug) : null;
  const row = await askQuestion(repo.id, {
    vendorId: vendor?.id ?? null,
    askedBy: "agent",
    question: input.question.trim(),
    why: input.why.trim(),
    options: input.options,
    lookupUrl: null,
    updates: null,
    key: `agent:${hash(input.question.trim().toLowerCase())}`,
  });
  return toQuestion(row, vendor?.name ?? null);
}

export async function loadActions(repoId: string, user: UserRow, status?: ActionRequest["status"]): Promise<ActionsResponse> {
  const repo = await repoForUser(repoId, user.id);
  const [rows, vendors, policy] = await Promise.all([actionsForRepo(repo.id, status), vendorsForRepo(repo.id), policyForRepo(repo.id)]);
  const names = new Map(vendors.map((v) => [v.id, v.name]));
  return { actions: rows.map((r) => toAction(r, r.vendor_id ? (names.get(r.vendor_id) ?? null) : null)), policy };
}

/** An agent (or birdsI) proposes an action. Auto-approved only within the repo's policy. */
export async function requestAction(repoId: string, user: UserRow, input: RequestActionRequest, requestedBy: ActionRequest["requestedBy"]): Promise<ActionRequest> {
  const repo = await repoForUser(repoId, user.id);
  const policy = await policyForRepo(repo.id);
  if (requestedBy === "agent" && !policy.allowPropose) throw new ApiError(403, "policy", "Agents may not propose commands in this repository. The owner can allow it on the Agent page.");
  const command = input.command.trim();
  if (!isAllowedCommand(command)) throw new ApiError(400, "bad_request", `Send one plain command that starts with one of ${ALLOWED_COMMANDS.join(", ")}, without shell operators or output redirection.`);
  const vendor = input.vendorSlug ? await vendorBySlug(repo.id, input.vendorSlug) : null;
  const monthly = input.estimatedMonthlyUsd ?? null;
  const once = input.estimatedOnceUsd ?? null;
  const cost = Math.max(monthly ?? 0, once ?? 0);
  const prefixOk = policy.autoApprovePrefixes.some((p) => command.startsWith(p));
  const autoApproved = requestedBy !== "owner" && policy.autoApproveUnderUsd !== null && cost <= policy.autoApproveUnderUsd && prefixOk;
  const row = await createActionRequest(repo.id, {
    vendorId: vendor?.id ?? null,
    requestedBy,
    title: input.title.trim(),
    reason: input.reason.trim(),
    command,
    estimatedMonthlyUsd: monthly,
    estimatedOnceUsd: once,
    autoApproved,
  });
  return toAction(row, vendor?.name ?? null);
}

export async function decideActionRequest(actionId: string, user: UserRow, decision: "approve" | "deny"): Promise<ActionRequest> {
  const row = await actionById(actionId);
  if (!row) throw new ApiError(404, "not_found", "Not found.");
  await repoForUser(row.repo_id, user.id);
  if (row.status !== "pending") throw new ApiError(409, "decided", `This request is already ${row.status}.`);
  const updated = await decideAction(row.id, user.id, decision);
  return toAction(updated, null);
}

/** The CLI reports what happened when it ran an approved command on the owner's machine. */
export async function reportActionResult(actionId: string, user: UserRow, ok: boolean, output: string): Promise<ActionRequest> {
  const row = await actionById(actionId);
  if (!row) throw new ApiError(404, "not_found", "Not found.");
  await repoForUser(row.repo_id, user.id);
  if (row.status !== "approved") throw new ApiError(409, "not_approved", `This request is ${row.status}, so there is nothing to report.`);
  return toAction(await reportAction(row.id, ok, output), null);
}

export async function loadActionForUser(actionId: string, user: UserRow): Promise<ActionRequest> {
  const row = await actionById(actionId);
  if (!row) throw new ApiError(404, "not_found", "Not found.");
  await repoForUser(row.repo_id, user.id);
  return toAction(row, null);
}

export async function changePolicy(repoId: string, user: UserRow, patch: UpdatePolicyRequest) {
  const repo = await repoForUser(repoId, user.id);
  return updatePolicy(repo.id, patch);
}

export async function loadVision(repoId: string, user: UserRow): Promise<Vision> {
  const repo = await repoForUser(repoId, user.id);
  return visionForRepo(repo.id);
}

export async function saveVision(repoId: string, user: UserRow, text: string): Promise<Vision> {
  const repo = await repoForUser(repoId, user.id);
  return setVision(repo.id, text);
}

/** Everything an agent needs about a repository in one call. */
export async function loadInventory(repoId: string, user: UserRow): Promise<InventoryResponse> {
  const repo = await repoForUser(repoId, user.id);
  const [vendors, vision, questions, actions, latest] = await Promise.all([loadVendors(repo.id, user), visionForRepo(repo.id), questionsForRepo(repo.id, "open"), actionsForRepo(repo.id, "pending"), latestDoneScan(repo.id)]);
  const findings = latest ? await findingsForScan(latest.id) : [];
  return {
    repo: { id: repo.id, fullName: repo.full_name, branch: repo.default_branch },
    vision,
    vendors: vendors.vendors,
    alerts: vendors.alerts,
    watches: vendors.watches,
    stages: vendors.stages,
    openQuestions: questions.length,
    pendingActions: actions.length,
    latestScan: latest ? { id: latest.id, kind: latest.kind, finishedAt: latest.finished_at, findings: findings.filter((f) => f.status !== "dismissed").length, headline: latest.summary?.headline ?? null } : null,
  };
}

// Connections (web only: tokens are pasted in the browser, never sent through the CLI)

export function connectorCatalog() {
  return connectorInfo();
}

export async function connectVendor(user: UserRow, input: { vendorSlug: string; token: string; settings: Record<string, string> }): Promise<void> {
  if (!isSecretsKeyConfigured()) throw new ApiError(500, "not_configured", "Connections are not available: BIRDSI_SECRETS_KEY is not set on the server.");
  const connector = CONNECTOR_BY_SLUG.get(input.vendorSlug);
  if (!connector) throw new ApiError(400, "bad_request", "birdsI has no connector for that service yet.");
  const token = input.token.trim();
  if (token.length < 8) throw new ApiError(400, "bad_request", "Paste the whole token.");
  const settings: Record<string, string> = {};
  for (const field of connector.fields) {
    const value = (input.settings[field.key] ?? "").trim();
    if (field.required && !value) throw new ApiError(400, "bad_request", `${field.label} is required.`);
    if (value) settings[field.key] = value;
  }
  // Prove the token works before storing it, so a typo never sits in the database.
  try {
    await connector.probe(token, settings);
  } catch (error) {
    throw new ApiError(400, "token_rejected", error instanceof Error ? error.message : "The service did not accept the token.");
  }
  await saveConnection(user.id, { vendorSlug: input.vendorSlug, token, label: null, settings });
}

export async function disconnectVendor(user: UserRow, connectionId: string): Promise<void> {
  await deleteConnection(connectionId, user.id);
}

export async function listConnections(user: UserRow) {
  const rows = await connectionsForUser(user.id);
  return rows.map((r) => ({ id: r.id, vendorSlug: r.vendor_slug, name: CONNECTOR_BY_SLUG.get(r.vendor_slug)?.name ?? r.vendor_slug, lastProbedAt: r.last_probed_at, lastStatus: r.last_status, lastError: r.last_error, createdAt: r.created_at }));
}

/** Queues a vendor sync for every repository the user owns that has been scanned, after a connection changes. */
export async function resyncAllRepos(user: UserRow): Promise<void> {
  const { reposForUser } = await import("@birdsi/db");
  const repos = await reposForUser(user.id);
  for (const repo of repos) {
    const latest = await latestDoneScan(repo.id);
    if (!latest) continue;
    if (await jobActive("vendor_sync", "repoId", repo.id)) continue;
    await enqueueJob("vendor_sync", { repoId: repo.id, ownerUserId: user.id, hints: null }, { maxAttempts: 1 });
  }
}

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16);
}

/** New and resolved findings between a scan and the latest finished one, by stable key. */
export async function changesSince(repoId: string, user: UserRow, sinceScanId: string | null): Promise<ChangesResponse> {
  const repo = await repoForUser(repoId, user.id);
  const done = (await scansForRepo(repo.id, 50)).filter((s) => s.status === "done");
  const latest = done[0];
  if (!latest) throw new ApiError(404, "no_scan", "This repository has not been scanned yet.");
  let from = sinceScanId ? await scanForViewer(sinceScanId, user.id) : (done[1] ?? null);
  if (from && from.repo_id !== repo.id) throw new ApiError(400, "bad_request", "That scan belongs to another repository.");
  if (from && from.id === latest.id) from = done[1] ?? null;
  const toRows = await findingsForScan(latest.id);
  const fromRows = from ? await findingsForScan(from.id) : [];
  const like = (f: (typeof toRows)[number]) => ({ id: f.id, key: f.key, title: f.title, severity: f.severity, confidence: f.confidence, status: f.status, path: f.location?.path ?? null });
  return {
    repoId: repo.id,
    from: from ? { scanId: from.id, finishedAt: from.finished_at } : null,
    to: { scanId: latest.id, finishedAt: latest.finished_at },
    ...diffFindings(fromRows.map(like), toRows.map(like)),
  };
}
