import type { ActionRequest, AgentPolicy, FactKind, Question, Vision } from "@birdsi/shared";
import { DEFAULT_AUTO_APPROVE_PREFIXES } from "@birdsi/shared";
import { getDb, NotFoundError, unwrap } from "./client";

/** Questions, action requests, policy and vision: the channel between agents, birdsI and the owner. */

export interface QuestionRow {
  id: string;
  repo_id: string;
  vendor_id: string | null;
  asked_by: Question["askedBy"];
  question: string;
  why: string;
  options: string[];
  lookup_url: string | null;
  updates: { kind: FactKind; metric: string; label: string; unit: string | null } | null;
  key: string;
  answer: string | null;
  status: Question["status"];
  created_at: string;
  answered_at: string | null;
}

export function toQuestion(row: QuestionRow, vendorName: string | null): Question {
  return {
    id: row.id,
    repoId: row.repo_id,
    vendorId: row.vendor_id,
    vendorName,
    askedBy: row.asked_by,
    question: row.question,
    why: row.why,
    options: row.options ?? [],
    lookupUrl: row.lookup_url,
    updates: row.updates,
    answer: row.answer,
    status: row.status,
    createdAt: row.created_at,
    answeredAt: row.answered_at,
  };
}

export interface QuestionInput {
  vendorId: string | null;
  askedBy: Question["askedBy"];
  question: string;
  why: string;
  options: string[];
  lookupUrl: string | null;
  updates: QuestionRow["updates"];
  key: string;
}

/** Inserts a question unless the same key is already open. Returns the open or new row. */
export async function askQuestion(repoId: string, input: QuestionInput): Promise<QuestionRow> {
  const db = getDb();
  const { data: existing, error: findError } = await db.from("questions").select().eq("repo_id", repoId).eq("key", input.key).eq("status", "open").maybeSingle();
  if (findError) throw new Error(`askQuestion find: ${findError.message}`);
  if (existing) return existing as QuestionRow;
  const result = await db
    .from("questions")
    .insert({ repo_id: repoId, vendor_id: input.vendorId, asked_by: input.askedBy, question: input.question, why: input.why, options: input.options, lookup_url: input.lookupUrl, updates: input.updates, key: input.key })
    .select()
    .single();
  return unwrap(result, "askQuestion") as QuestionRow;
}

export async function questionsForRepo(repoId: string, status?: Question["status"]): Promise<QuestionRow[]> {
  const db = getDb();
  let query = db.from("questions").select().eq("repo_id", repoId).order("created_at", { ascending: false }).limit(200);
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw new Error(`questionsForRepo: ${error.message}`);
  return (data ?? []) as QuestionRow[];
}

export async function questionById(questionId: string): Promise<QuestionRow | null> {
  const db = getDb();
  const { data, error } = await db.from("questions").select().eq("id", questionId).maybeSingle();
  if (error) throw new Error(`questionById: ${error.message}`);
  return (data as QuestionRow | null) ?? null;
}

export async function answerQuestionRow(questionId: string, answer: string | null, status: "answered" | "dismissed"): Promise<QuestionRow> {
  const db = getDb();
  const result = await db.from("questions").update({ answer, status, answered_at: new Date().toISOString() }).eq("id", questionId).select().single();
  return unwrap(result, "answerQuestionRow") as QuestionRow;
}

/** Closes open questions about a vendor fact that a connector has since answered. */
export async function resolveQuestionsByMetric(repoId: string, vendorId: string, metric: string): Promise<void> {
  const db = getDb();
  const { data, error } = await db.from("questions").select("id, updates").eq("repo_id", repoId).eq("vendor_id", vendorId).eq("status", "open");
  if (error) throw new Error(`resolveQuestionsByMetric: ${error.message}`);
  const ids = ((data ?? []) as Array<{ id: string; updates: QuestionRow["updates"] }>).filter((q) => q.updates?.metric === metric).map((q) => q.id);
  if (ids.length === 0) return;
  const { error: upError } = await db.from("questions").update({ status: "dismissed", answered_at: new Date().toISOString() }).in("id", ids);
  if (upError) throw new Error(`resolveQuestionsByMetric update: ${upError.message}`);
}

// Action requests

export interface ActionRow {
  id: string;
  repo_id: string;
  vendor_id: string | null;
  requested_by: ActionRequest["requestedBy"];
  title: string;
  reason: string;
  command: string;
  estimated_monthly_usd: number | null;
  estimated_once_usd: number | null;
  status: ActionRequest["status"];
  auto_approved: boolean;
  decided_by: string | null;
  decided_at: string | null;
  result: string | null;
  created_at: string;
  expires_at: string;
}

export function toAction(row: ActionRow, vendorName: string | null): ActionRequest {
  return {
    id: row.id,
    repoId: row.repo_id,
    vendorId: row.vendor_id,
    vendorName,
    requestedBy: row.requested_by,
    title: row.title,
    reason: row.reason,
    command: row.command,
    estimatedMonthlyUsd: row.estimated_monthly_usd,
    estimatedOnceUsd: row.estimated_once_usd,
    status: row.status,
    autoApproved: row.auto_approved,
    decidedAt: row.decided_at,
    result: row.result,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

export async function createActionRequest(repoId: string, input: { vendorId: string | null; requestedBy: ActionRequest["requestedBy"]; title: string; reason: string; command: string; estimatedMonthlyUsd: number | null; estimatedOnceUsd: number | null; autoApproved: boolean }): Promise<ActionRow> {
  const db = getDb();
  const result = await db
    .from("action_requests")
    .insert({
      repo_id: repoId,
      vendor_id: input.vendorId,
      requested_by: input.requestedBy,
      title: input.title,
      reason: input.reason,
      command: input.command,
      estimated_monthly_usd: input.estimatedMonthlyUsd,
      estimated_once_usd: input.estimatedOnceUsd,
      status: input.autoApproved ? "approved" : "pending",
      auto_approved: input.autoApproved,
      decided_at: input.autoApproved ? new Date().toISOString() : null,
    })
    .select()
    .single();
  return unwrap(result, "createActionRequest") as ActionRow;
}

export async function actionsForRepo(repoId: string, status?: ActionRequest["status"]): Promise<ActionRow[]> {
  const db = getDb();
  // Expire what nobody decided in time.
  const { error: expError } = await db.from("action_requests").update({ status: "expired" }).eq("repo_id", repoId).eq("status", "pending").lt("expires_at", new Date().toISOString());
  if (expError) throw new Error(`actionsForRepo expire: ${expError.message}`);
  let query = db.from("action_requests").select().eq("repo_id", repoId).order("created_at", { ascending: false }).limit(200);
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw new Error(`actionsForRepo: ${error.message}`);
  return (data ?? []) as ActionRow[];
}

export async function actionById(actionId: string): Promise<ActionRow | null> {
  const db = getDb();
  const { data, error } = await db.from("action_requests").select().eq("id", actionId).maybeSingle();
  if (error) throw new Error(`actionById: ${error.message}`);
  return (data as ActionRow | null) ?? null;
}

export async function decideAction(actionId: string, userId: string, decision: "approve" | "deny"): Promise<ActionRow> {
  const db = getDb();
  const result = await db
    .from("action_requests")
    .update({ status: decision === "approve" ? "approved" : "denied", decided_by: userId, decided_at: new Date().toISOString() })
    .eq("id", actionId)
    .eq("status", "pending")
    .select()
    .maybeSingle();
  if (result.error) throw new Error(`decideAction: ${result.error.message}`);
  if (!result.data) throw new NotFoundError("action");
  return result.data as ActionRow;
}

export async function reportAction(actionId: string, ok: boolean, output: string): Promise<ActionRow> {
  const db = getDb();
  const result = await db
    .from("action_requests")
    .update({ status: ok ? "executed" : "failed", result: output.slice(0, 20_000) })
    .eq("id", actionId)
    .eq("status", "approved")
    .select()
    .maybeSingle();
  if (result.error) throw new Error(`reportAction: ${result.error.message}`);
  if (!result.data) throw new NotFoundError("action");
  return result.data as ActionRow;
}

// Policy

export interface PolicyRow {
  repo_id: string;
  allow_read: boolean;
  allow_propose: boolean;
  auto_approve_under_usd: number | null;
  auto_approve_prefixes: string[];
  updated_at: string;
}

export function toPolicy(row: PolicyRow | null, repoId: string): AgentPolicy {
  if (!row) return { repoId, allowRead: true, allowPropose: true, autoApproveUnderUsd: null, autoApprovePrefixes: DEFAULT_AUTO_APPROVE_PREFIXES, updatedAt: new Date(0).toISOString() };
  return {
    repoId: row.repo_id,
    allowRead: row.allow_read,
    allowPropose: row.allow_propose,
    autoApproveUnderUsd: row.auto_approve_under_usd,
    autoApprovePrefixes: row.auto_approve_prefixes?.length ? row.auto_approve_prefixes : DEFAULT_AUTO_APPROVE_PREFIXES,
    updatedAt: row.updated_at,
  };
}

export async function policyForRepo(repoId: string): Promise<AgentPolicy> {
  const db = getDb();
  const { data, error } = await db.from("agent_policies").select().eq("repo_id", repoId).maybeSingle();
  if (error) throw new Error(`policyForRepo: ${error.message}`);
  return toPolicy((data as PolicyRow | null) ?? null, repoId);
}

export async function updatePolicy(repoId: string, patch: { allowPropose?: boolean; autoApproveUnderUsd?: number | null }): Promise<AgentPolicy> {
  const db = getDb();
  const current = await policyForRepo(repoId);
  const result = await db
    .from("agent_policies")
    .upsert(
      {
        repo_id: repoId,
        allow_read: current.allowRead,
        allow_propose: patch.allowPropose ?? current.allowPropose,
        auto_approve_under_usd: patch.autoApproveUnderUsd === undefined ? current.autoApproveUnderUsd : patch.autoApproveUnderUsd,
        auto_approve_prefixes: current.autoApprovePrefixes,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "repo_id" },
    )
    .select()
    .single();
  return toPolicy(unwrap(result, "updatePolicy") as PolicyRow, repoId);
}

// Vision

export async function visionForRepo(repoId: string): Promise<Vision> {
  const db = getDb();
  const { data, error } = await db.from("repos").select("vision, vision_updated_at").eq("id", repoId).maybeSingle();
  if (error) throw new Error(`visionForRepo: ${error.message}`);
  const row = data as { vision: string | null; vision_updated_at: string | null } | null;
  return { repoId, text: row?.vision ?? "", updatedAt: row?.vision_updated_at ?? null };
}

export async function setVision(repoId: string, text: string): Promise<Vision> {
  const db = getDb();
  const at = new Date().toISOString();
  const { error } = await db.from("repos").update({ vision: text.trim() === "" ? null : text, vision_updated_at: at }).eq("id", repoId);
  if (error) throw new Error(`setVision: ${error.message}`);
  return { repoId, text, updatedAt: at };
}
