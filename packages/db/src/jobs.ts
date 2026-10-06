import { getDb, unwrap } from "./client";
import { schemaHas } from "./schema";

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

/** Jobs a person is waiting on run first: quick checks 10, fixes 5, everything else 0. */
export const JOB_PRIORITY = { interactive: 10, fix: 5, background: 0 } as const;

export async function enqueueJob(kind: JobKind, payload: Record<string, unknown>, options: { maxAttempts?: number; priority?: number } = {}): Promise<JobRow> {
  const db = getDb();
  const row: Record<string, unknown> = { kind, payload, max_attempts: options.maxAttempts ?? 2 };
  if (options.priority !== undefined && options.priority !== 0 && (await schemaHas("jobs.priority"))) row["priority"] = options.priority;
  const result = await db.from("jobs").insert(row).select().single();
  return unwrap(result, "enqueueJob") as JobRow;
}

export interface WorkerPresence {
  id: string;
  hostname: string;
  version: string | null;
  currentJobId: string | null;
}

/** A worker process reporting in; nothing happens until the workers table exists. */
export async function workerSeen(presence: WorkerPresence): Promise<void> {
  if (!(await schemaHas("workers"))) return;
  const db = getDb();
  const { error } = await db
    .from("workers")
    .upsert({ id: presence.id, hostname: presence.hostname, version: presence.version, current_job_id: presence.currentJobId, last_seen_at: new Date().toISOString() }, { onConflict: "id" });
  if (error) throw new Error(`workerSeen: ${error.message}`);
}

/** When any worker last reported in; null when none has, or before the migration. */
export async function lastWorkerSeenAt(): Promise<string | null> {
  if (!(await schemaHas("workers"))) return null;
  const db = getDb();
  const { data, error } = await db.from("workers").select("last_seen_at").order("last_seen_at", { ascending: false }).limit(1);
  if (error) throw new Error(`lastWorkerSeenAt: ${error.message}`);
  return ((data ?? []) as Array<{ last_seen_at: string }>)[0]?.last_seen_at ?? null;
}

/** Removes presence rows of processes not seen for this many days. */
export async function purgeStaleWorkers(days: number): Promise<number> {
  if (!(await schemaHas("workers"))) return 0;
  const db = getDb();
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data, error } = await db.from("workers").delete().lt("last_seen_at", cutoff).select("id");
  if (error) throw new Error(`purgeStaleWorkers: ${error.message}`);
  return ((data ?? []) as unknown[]).length;
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
