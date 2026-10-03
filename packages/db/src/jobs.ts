import { getDb, unwrap } from "./client";

export type JobKind = "scan" | "fix" | "embed" | "vendor_sync";

export interface JobRow {
  id: string;
  kind: JobKind;
  payload: Record<string, unknown>;
  status: "queued" | "running" | "done" | "failed";
  attempts: number;
  max_attempts: number;
  run_after: string;
  locked_by: string | null;
  locked_at: string | null;
  heartbeat_at: string | null;
  last_error: string | null;
  created_at: string;
  finished_at: string | null;
}

export async function enqueueJob(kind: JobKind, payload: Record<string, unknown>, options: { maxAttempts?: number } = {}): Promise<JobRow> {
  const db = getDb();
  const result = await db.from("jobs").insert({ kind, payload, max_attempts: options.maxAttempts ?? 2 }).select().single();
  return unwrap(result, "enqueueJob") as JobRow;
}

/** Claims the oldest runnable job with SKIP LOCKED semantics (see claim_job in the migration). */
export async function claimJob(workerId: string, kinds: JobKind[]): Promise<JobRow | null> {
  const db = getDb();
  const { data, error } = await db.rpc("claim_job", { worker: workerId, kinds });
  if (error) throw new Error(`claimJob: ${error.message}`);
  const rows = (data ?? []) as JobRow[];
  return rows[0] ?? null;
}

export async function heartbeat(jobId: string): Promise<void> {
  const db = getDb();
  const { error } = await db.from("jobs").update({ heartbeat_at: new Date().toISOString() }).eq("id", jobId);
  if (error) throw new Error(`heartbeat: ${error.message}`);
}

export async function completeJob(jobId: string): Promise<void> {
  const db = getDb();
  const { error } = await db.from("jobs").update({ status: "done", finished_at: new Date().toISOString(), locked_by: null }).eq("id", jobId);
  if (error) throw new Error(`completeJob: ${error.message}`);
}

/** Fails the job; requeues with a delay while attempts remain. */
export async function failJob(job: JobRow, message: string): Promise<void> {
  const db = getDb();
  const retry = job.attempts < job.max_attempts;
  const { error } = await db
    .from("jobs")
    .update({
      status: retry ? "queued" : "failed",
      last_error: message.slice(0, 2000),
      locked_by: null,
      locked_at: null,
      run_after: retry ? new Date(Date.now() + 30_000).toISOString() : job.run_after,
      finished_at: retry ? null : new Date().toISOString(),
    })
    .eq("id", job.id);
  if (error) throw new Error(`failJob: ${error.message}`);
}

/** True when a job of this kind with this payload key is queued or running. */
export async function jobActive(kind: JobKind, payloadKey: string, payloadValue: string): Promise<boolean> {
  const db = getDb();
  const { data, error } = await db.from("jobs").select("id").eq("kind", kind).in("status", ["queued", "running"]).contains("payload", { [payloadKey]: payloadValue }).limit(1);
  if (error) throw new Error(`jobActive: ${error.message}`);
  return ((data ?? []) as unknown[]).length > 0;
}

export async function queueDepth(): Promise<number> {
  const db = getDb();
  const { count, error } = await db.from("jobs").select("id", { count: "exact", head: true }).eq("status", "queued");
  if (error) throw new Error(`queueDepth: ${error.message}`);
  return count ?? 0;
}
