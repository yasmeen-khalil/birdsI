import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendEvent,
  downloadSnapshot,
  enqueueJob,
  ensureAppForRepo,
  insertDependencies,
  insertFindings,
  latestServiceMap,
  MAPS_MIGRATION,
  recordUsage,
  releaseSnapshot,
  replaceVendors,
  repoForUser,
  repoWithInstallation,
  saveServiceMap,
  scanById,
  snapshotById,
  stopRequested,
  updateScan,
  JobLostError,
  type JobRow,
} from "@birdsi/db";
import { GitHubSource, runScan, snapshotFromTarball, type EngineConfig, type Snapshot } from "@birdsi/engine";
import type { ProjectHints, ScanEvent, ServiceMap } from "@birdsi/shared";
import { spendHook } from "./spend";

/** An error written for the person who started the map; its message is shown as it is. */
export class PlainError extends Error {
  override name = "PlainError";
}

/** What the scan page shows for a failure. Anything not written for people stays in the worker log and the job's last_error. */
function shownError(error: unknown): string {
  if (error instanceof PlainError) return error.message;
  return "The map stopped because of a problem on birdsI's side. Run it again in a few minutes.";
}

/**
 * Runs one map of the code end to end: resolves the code, runs the engine,
 * stores findings, dependencies and vendors, then queues a read of the
 * accounts so the cockpit pairs the new map with live facts.
 */
export async function runScanJob(config: EngineConfig, job: JobRow, heartbeat: () => Promise<void>): Promise<void> {
  const scanId = String(job.payload["scanId"]);
  const scan = await scanById(scanId);
  if (!scan) throw new Error(`scan ${scanId} not found`);
  if (scan.status === "done" || scan.status === "stopped") return;

  await updateScan(scanId, { status: "running", started_at: new Date().toISOString(), error: null });
  // A retried scan (a worker died mid-run) continues the event log where it stopped.
  let seq = await lastEventSeq(scanId);
  const controller = new AbortController();
  const emit = async (event: ScanEvent) => {
    seq += 1;
    await appendEvent(scanId, seq, event);
  };
  const spend = spendHook(scan.owner_user_id);

  // Stop requests from the UI and job heartbeats share one timer.
  let lost = false;
  const ticker = setInterval(() => {
    void (async () => {
      try {
        await heartbeat();
        if (await stopRequested(scanId)) controller.abort();
      } catch (error) {
        // A missed heartbeat is not fatal. A job that is no longer this worker's is: stop and write nothing.
        if (error instanceof JobLostError) {
          lost = true;
          controller.abort();
        }
      }
    })();
  }, 15_000);
  const assertHeld = () => {
    if (lost) throw new JobLostError(`scan ${scanId} was taken from this worker`);
  };

  let snapshot: Snapshot | null = null;
  const hints: ProjectHints | null = scan.snapshot_id ? (((await snapshotById(scan.snapshot_id))?.project_hints as ProjectHints | null) ?? null) : null;
  // The previous map lets the model read only the files that changed since.
  const previousMap = scan.repo_id ? await latestServiceMap(scan.repo_id).catch(() => null) : null;
  try {
    const result = await runScan(config, {
      previousMap: previousMap?.map ?? null,
      snapshot: async () => {
        snapshot = await resolveSnapshot(config, scan.repo_id, scan.snapshot_id, scan.branch);
        if (snapshot.commitSha || snapshot.branch) await updateScan(scanId, { commit_sha: snapshot.commitSha, branch: snapshot.branch ?? scan.branch });
        return snapshot;
      },
      projectHints: hints,
      onVendors: async (vendors) => {
        if (scan.repo_id) await replaceVendors(scan.repo_id, scanId, vendors);
      },
      onMap: async (map) => {
        if (!scan.repo_id) return;
        assertHeld();
        const note = await keepMap(scan.repo_id, scan.owner_user_id, scanId, map);
        if (note) await emit({ type: "note", text: note });
      },
      signal: controller.signal,
      onEvent: emit,
      beforeCall: spend.beforeCall,
      onUsage: (u) => recordUsage({ ownerUserId: scan.owner_user_id, scanId, purpose: u.purpose, model: u.model, inputTokens: u.inputTokens, outputTokens: u.outputTokens, costMicrodollars: u.costMicrodollars }),
    });
    const refusal = spend.refusal();
    if (refusal) await emit({ type: "note", text: `The docs check stopped early. ${refusal}` });

    assertHeld();
    const rows = await insertFindings(scanId, scan.repo_id, result.findings);
    await insertDependencies(scanId, result.dependencies);
    const idByKey = new Map(rows.map((r) => [r.key, r.id]));
    const summary = { ...result.summary, startWith: result.summary.startWith.map((key) => idByKey.get(key) ?? key) };

    if (controller.signal.aborted) {
      assertHeld();
      await emit({ type: "scan_stopped" });
      await updateScan(scanId, { status: "stopped", finished_at: new Date().toISOString(), summary, stats: result.stats });
      return;
    }
    await updateScan(scanId, { status: "done", finished_at: new Date().toISOString(), summary, stats: result.stats });

    if (scan.repo_id) {
      await replaceVendors(scan.repo_id, scanId, result.vendors);
      if (scan.owner_user_id) await enqueueJob("vendor_sync", { repoId: scan.repo_id, ownerUserId: scan.owner_user_id, hints }, { maxAttempts: 1 });
    }
  } catch (error) {
    assertHeld();
    if (controller.signal.aborted) {
      await emit({ type: "scan_stopped" });
      await updateScan(scanId, { status: "stopped", finished_at: new Date().toISOString() });
      return;
    }
    const shown = shownError(error);
    await emit({ type: "scan_failed", error: shown.slice(0, 500) });
    await updateScan(scanId, { status: "failed", finished_at: new Date().toISOString(), error: shown.slice(0, 1000) });
    throw error;
  } finally {
    clearInterval(ticker);
    await (snapshot as Snapshot | null)?.cleanup();
    // The uploaded code is deleted as soon as its map has run; nothing needs it afterwards.
    if (scan.snapshot_id && !lost) await releaseSnapshot(scan.snapshot_id).catch((error) => console.error(`[worker] could not delete snapshot ${scan.snapshot_id}: ${error instanceof Error ? error.message : String(error)}`));
  }
}

/** Stores the map with its app. Returns a line for the run when it could not be kept; never throws, the map of the code goes on. */
async function keepMap(repoId: string, ownerUserId: string | null, scanId: string, map: ServiceMap): Promise<string | null> {
  try {
    const repo = ownerUserId ? await repoForUser(repoId, ownerUserId) : null;
    const app = repo ? await ensureAppForRepo(repo) : null;
    const kept = await saveServiceMap({ repoId, appId: app?.id ?? null, scanId, map });
    return kept ? null : `The service map was read but not kept: the migration ${MAPS_MIGRATION} has not run on birdsI's database yet.`;
  } catch (error) {
    console.error(`[worker] could not keep the service map of scan ${scanId}: ${error instanceof Error ? error.message : String(error)}`);
    return "The service map was read but could not be saved. The next map tries again.";
  }
}

async function lastEventSeq(scanId: string): Promise<number> {
  const { getDb } = await import("@birdsi/db");
  const { data, error } = await getDb().from("scan_events").select("seq").eq("scan_id", scanId).order("seq", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`lastEventSeq: ${error.message}`);
  return (data as { seq: number } | null)?.seq ?? 0;
}

/** Where the code comes from: an uploaded snapshot from the terminal tool, or the GitHub App. */
export async function resolveSnapshot(config: EngineConfig, repoId: string | null, snapshotId: string | null, branch: string | null): Promise<Snapshot> {
  if (snapshotId) {
    const row = await snapshotById(snapshotId);
    if (!row || !row.uploaded_at) throw new PlainError("The uploaded code snapshot is missing or incomplete.");
    if (!row.storage_path) throw new PlainError("The uploaded code was deleted after the retention window (seven days). Run birdsi again to upload it.");
    const dir = await mkdtemp(join(tmpdir(), "birdsi-snap-"));
    const tarPath = join(dir, "snapshot.tgz");
    await downloadSnapshot(row, tarPath);
    const snap = await snapshotFromTarball(tarPath, { fullName: row.full_name, branch: row.branch, commitSha: row.commit_sha });
    const inner = snap.cleanup;
    snap.cleanup = async () => {
      await inner();
      await rm(dir, { recursive: true, force: true });
    };
    return snap;
  }
  if (repoId) {
    const { repo, installation } = await repoWithInstallation(repoId);
    if (!installation || installation.removed_at) throw new PlainError("The GitHub App is no longer installed for this repository. Reconnect it from Settings.");
    if (installation.suspended_at) throw new PlainError("The GitHub App installation is suspended. Resume it on GitHub, then map again.");
    if (!GitHubSource.isConfigured(config)) throw new PlainError("The GitHub App is not configured on the server.");
    const [owner, name] = repo.full_name.split("/") as [string, string];
    const github = new GitHubSource(config);
    return github.snapshot({ owner, name, installationId: installation.github_installation_id }, branch ?? repo.default_branch);
  }
  throw new PlainError("The map has no code source.");
}
