import type { Fix } from "@birdsi/shared";
import { getDb, unwrap } from "./client";

export interface FixRow {
  id: string;
  finding_id: string;
  requested_by: string | null;
  status: Fix["status"];
  summary: string | null;
  patch: string | null;
  files: Array<{ path: string; content: string | null; before: string | null }> | null;
  verify_command: string | null;
  test_log: string | null;
  follow_up: string[];
  pr_number: number | null;
  pr_url: string | null;
  branch_name: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export function toFix(row: FixRow): Fix {
  return {
    id: row.id,
    findingId: row.finding_id,
    status: row.status,
    patch: row.patch,
    testLog: row.test_log,
    prNumber: row.pr_number,
    prUrl: row.pr_url,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createFix(findingId: string, requestedBy: string | null): Promise<FixRow> {
  const db = getDb();
  const result = await db.from("fixes").insert({ finding_id: findingId, requested_by: requestedBy }).select().single();
  return unwrap(result, "createFix") as FixRow;
}

export async function fixById(fixId: string): Promise<FixRow | null> {
  const db = getDb();
  const { data, error } = await db.from("fixes").select().eq("id", fixId).maybeSingle();
  if (error) throw new Error(`fixById: ${error.message}`);
  return (data as FixRow | null) ?? null;
}

export async function latestFixForFinding(findingId: string): Promise<FixRow | null> {
  const db = getDb();
  const { data, error } = await db.from("fixes").select().eq("finding_id", findingId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`latestFixForFinding: ${error.message}`);
  return (data as FixRow | null) ?? null;
}

export async function updateFix(fixId: string, patch: Partial<Omit<FixRow, "id" | "finding_id" | "created_at">>): Promise<void> {
  const db = getDb();
  const { error } = await db.from("fixes").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", fixId);
  if (error) throw new Error(`updateFix: ${error.message}`);
}
