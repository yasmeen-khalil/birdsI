import { hostname } from "node:os";
import { claimJob, completeJob, failJob, heartbeat, purgeOldSnapshots, type JobRow } from "@birdsi/db";
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
  const beat = () => heartbeat(job.id);
  if (job.kind === "scan") return runScanJob(config, job, beat);
  if (job.kind === "fix") return runFixJob(config, job, beat);
  if (job.kind === "embed") return runEmbedJob(config, job, beat);
  if (job.kind === "vendor_sync") return runVendorSyncJob(config, job, beat);
  throw new Error(`unknown job kind ${job.kind}`);
}

const SWEEP_MS = 3_600_000;
let lastSweep = 0;

/** Snapshot files older than the retention window are removed once an hour, as the privacy policy says. */
async function sweep(): Promise<void> {
  if (Date.now() - lastSweep < SWEEP_MS) return;
  lastSweep = Date.now();
  try {
    const removed = await purgeOldSnapshots(7);
    if (removed > 0) console.log(`[worker] removed ${removed} snapshot file(s) past retention`);
  } catch (error) {
    console.error(`[worker] snapshot sweep failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function loop(): Promise<void> {
  console.log(`[worker ${workerId}] started`);
  while (!stopping) {
    await sweep();
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
    try {
      await handle(job);
      await completeJob(job.id);
      console.log(`[worker] ${job.kind} ${job.id} done in ${Math.round((Date.now() - started) / 1000)}s`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[worker] ${job.kind} ${job.id} failed: ${message}`);
      try {
        await failJob(job, message);
      } catch (inner) {
        console.error(`[worker] could not record failure: ${inner instanceof Error ? inner.message : String(inner)}`);
      }
    }
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
