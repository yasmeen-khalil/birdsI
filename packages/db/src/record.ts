import type { RecordAuthorKind, RecordEntry, RecordKind } from "@birdsi/shared";
import { getDb } from "./client";
import { schemaHas } from "./schema";

export interface RecordRow {
  id: string;
  repo_id: string;
  kind: RecordKind;
  author_kind: RecordAuthorKind;
  author_label: string | null;
  subject: string | null;
  text: string;
  why: string | null;
  data: Record<string, unknown>;
  created_at: string;
}

export function toRecordEntry(row: RecordRow): RecordEntry {
  return { id: row.id, repoId: row.repo_id, kind: row.kind, authorKind: row.author_kind, authorLabel: row.author_label, subject: row.subject, text: row.text, why: row.why, data: row.data ?? {}, createdAt: row.created_at };
}

export interface RecordInput {
  kind: RecordKind;
  authorKind: RecordAuthorKind;
  authorLabel?: string | null;
  subject?: string | null;
  text: string;
  why?: string | null;
  data?: Record<string, unknown>;
}

/** True once the record migration has run. */
export function recordAvailable(): Promise<boolean> {
  return schemaHas("record_entries");
}

/** Appends to the record. Before the record migration has run it writes nothing and returns null. */
export async function addRecordEntry(repoId: string, input: RecordInput): Promise<RecordRow | null> {
  if (!(await recordAvailable())) return null;
  const db = getDb();
  const { data, error } = await db
    .from("record_entries")
    .insert({
      repo_id: repoId,
      kind: input.kind,
      author_kind: input.authorKind,
      author_label: input.authorLabel ?? null,
      subject: input.subject ?? null,
      text: input.text,
      why: input.why ?? null,
      data: input.data ?? {},
    })
    .select()
    .single();
  if (error) throw new Error(`addRecordEntry: ${error.message}`);
  return data as RecordRow;
}

/** The newest entry per subject of one kind: the prompt per section, and any other record where the latest entry wins. */
export async function latestRecordBySubject(repoId: string, kind: RecordKind): Promise<Map<string, RecordRow>> {
  const out = new Map<string, RecordRow>();
  for (const row of await recordForRepo(repoId, { kind, limit: 200 })) if (row.subject && !out.has(row.subject)) out.set(row.subject, row);
  return out;
}

/** The owner's prompt additions for a repository, by section, for the worker before a map. */
export async function promptsForRepo(repoId: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [subject, row] of await latestRecordBySubject(repoId, "prompt")) if (row.text.trim()) out[subject] = row.text;
  return out;
}

/** Newest first. Empty before the record migration has run. */
export async function recordForRepo(repoId: string, options: { kind?: RecordKind; limit?: number } = {}): Promise<RecordRow[]> {
  if (!(await recordAvailable())) return [];
  const db = getDb();
  let query = db.from("record_entries").select().eq("repo_id", repoId).order("created_at", { ascending: false }).limit(Math.min(options.limit ?? 50, 200));
  if (options.kind) query = query.eq("kind", options.kind);
  const { data, error } = await query;
  if (error) throw new Error(`recordForRepo: ${error.message}`);
  return (data ?? []) as RecordRow[];
}
