import { hostname } from "node:os";
import { claimJob, completeJob, enqueueJob, failExhaustedStaleJobs, failJob, heartbeat, JobLostError, jobActive, purgeOldSnapshots, purgeStaleWorkers, reposDueForSync, sweepDeviceLogins, updateFix, updateScan, userIdsWithConnections, workerSeen, type JobRow } from "@birdsi/db";
import { loadEngineConfig } from "@birdsi/engine";
import { runEmbedJob } from "./embed-job";
import { runFixJob } from "./fix-job";
import { runScanJob } from "./scan-job";
import { runVendorSyncJob } from "./vendor-sync-job";

/**
 * The birdsI worker: claims jobs from the queue and runs them one at a time.
 * Run several processes for parallelism; the claim is safe across workers.
 */
const workerId = `${hostname()}-${process.pid}`;
const config = loadEngineConfig();
const IDLE_MS = Number.parseInt(process.env["BIRDSI_WORKER_POLL_MS"] ?? "3000", 10);
let stopping = false;

process.on("SIGTERM", () => (stopping = true));
process.on("SIGINT", () => (stopping = true));

async function handle(job: JobRow): Promise<void> {
  const beat = async () => {
    await heartbeat(job.id, workerId);
    await present(job.id);
  };
  if (job.kind === "scan") return runScanJob(config, job, beat);
  if (job.kind === "fix") return runFixJob(config, job, beat);
  if (job.kind === "embed") return runEmbedJob(config, job, beat);
  if (job.kind === "vendor_sync") return runVendorSyncJob(config, job, beat);
  throw new Error(`unknown job kind ${job.kind}`);
}

const SWEEP_MS = 3_600_000;
let lastSweep = 0;
const version = process.env["RAILWAY_GIT_COMMIT_SHA"]?.slice(0, 7) ?? process.env["BIRDSI_VERSION"] ?? null;
const PRESENCE_MS = 30_000;
let lastPresence = 0;
let lastPresenceError = 0;

/** The worker reports in every half minute and at every job boundary, so the app can say when no scanner is running. */
async function present(currentJobId: string | null, force = false): Promise<void> {
  if (!force && Date.now() - lastPresence < PRESENCE_MS) return;
  lastPresence = Date.now();
  try {
    await workerSeen({ id: workerId, hostname: hostname(), version, currentJobId });
  } catch (error) {
    if (Date.now() - lastPresenceError > 600_000) {
      lastPresenceError = Date.now();
      console.error(`[worker] presence failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/**
 * Vendor syncs on a schedule, from the worker so no outside cron is needed:
 * hourly for owners with a connected account (their numbers move), daily for
 * everyone else. A repository with a sync already queued or running is skipped.
 */
async function scheduleVendorSyncs(): Promise<number> {
  const connected = new Set(await userIdsWithConnections());
  const hourly = (await reposDueForSync(1, 200)).filter((r) => connected.has(r.owner_user_id));
  const daily = await reposDueForSync(20, 200);
  const seen = new Set<string>();
  let queued = 0;
  for (const repo of [...hourly, ...daily]) {
    if (seen.has(repo.id)) continue;
    seen.add(repo.id);
    if (await jobActive("vendor_sync", "repoId", repo.id)) continue;
    await enqueueJob("vendor_sync", { repoId: repo.id, ownerUserId: repo.owner_user_id, hints: null }, { maxAttempts: 1 });
    queued += 1;
  }
  return queued;
}

/** Once an hour: snapshot files past retention go, stale worker rows go, old sign-in codes expire, due vendor syncs are queued. */
async function sweep(): Promise<void> {
  if (Date.now() - lastSweep < SWEEP_MS) return;
  lastSweep = Date.now();
  try {
    const removed = await purgeOldSnapshots(7);
    if (removed > 0) console.log(`[worker] removed ${removed} snapshot file(s) past retention`);
  } catch (error) {
    console.error(`[worker] snapshot sweep failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    await purgeStaleWorkers(7);
  } catch (error) {
    console.error(`[worker] worker sweep failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    const expired = await sweepDeviceLogins();
    if (expired > 0) console.log(`[worker] expired ${expired} sign-in code(s)`);
  } catch (error) {
    console.error(`[worker] sign-in code sweep failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    const queued = await scheduleVendorSyncs();
    if (queued > 0) console.log(`[worker] scheduled ${queued} vendor sync(s)`);
  } catch (error) {
    console.error(`[worker] sync schedule failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const STALE_SWEEP_MS = 30_000;
let lastStaleSweep = 0;

/** Jobs whose worker died with no attempts left are failed, and the scan or fix they were running says so. */
async function failExhausted(): Promise<void> {
  if (Date.now() - lastStaleSweep < STALE_SWEEP_MS) return;
  lastStaleSweep = Date.now();
  try {
    for (const job of await failExhaustedStaleJobs()) {
      console.error(`[worker] ${job.kind} ${job.id} failed: its worker stopped and no attempts are left`);
      const finished_at = new Date().toISOString();
      if (job.kind === "scan") await updateScan(String(job.payload["scanId"]), { status: "failed", finished_at, error: "The scanner stopped while working on this scan. Run it again." });
      if (job.kind === "fix") await updateFix(String(job.payload["fixId"]), { status: "failed", error: "The scanner stopped while working on this fix. Try it again." });
    }
  } catch (error) {
    console.error(`[worker] stale job sweep failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function loop(): Promise<void> {
  console.log(`[worker ${workerId}] started`);
  while (!stopping) {
    await sweep();
    await present(null);
    await failExhausted();
    let job: JobRow | null = null;
    try {
      job = await claimJob(workerId, ["scan", "fix", "embed", "vendor_sync"]);
    } catch (error) {
      console.error(`[worker] claim failed: ${error instanceof Error ? error.message : String(error)}`);
      await sleep(IDLE_MS * 3);
      continue;
    }
    if (!job) {
      await sleep(IDLE_MS);
      continue;
    }
    const started = Date.now();
    console.log(`[worker] ${job.kind} ${job.id} started (attempt ${job.attempts})`);
    await present(job.id, true);
    try {
      await handle(job);
      await completeJob(job.id, workerId);
      console.log(`[worker] ${job.kind} ${job.id} done in ${Math.round((Date.now() - started) / 1000)}s`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof JobLostError) {
        console.error(`[worker] ${job.kind} ${job.id} was taken from this worker: ${message}`);
      } else {
        console.error(`[worker] ${job.kind} ${job.id} failed: ${message}`);
        try {
          await failJob(job, workerId, message);
        } catch (inner) {
          console.error(`[worker] could not record failure: ${inner instanceof Error ? inner.message : String(inner)}`);
        }
      }
    }
    await present(null, true);
  }
  console.log(`[worker ${workerId}] stopped`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

loop().catch((error) => {
  console.error(error);
  process.exit(1);
});
