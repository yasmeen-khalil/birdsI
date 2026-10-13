import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  appendEvent,
  connectionsForUser,
  downloadSnapshot,
  lastEventOfType,
  findingsForScan,
  latestDoneScan,
  factHistory,
  factsForVendors,
  knowledgeFor,
  toVendor,
  vendorsForRepo,
  enqueueJob,
  insertDependencies,
  insertFindings,
  recordUsage,
  replaceVendors,
  repoWithInstallation,
  scanById,
  snapshotById,
  stopRequested,
  updateScan,
  JobLostError,
  type JobRow,
} from "@birdsi/db";
import { computeAlerts, computeRunway, computeWatches, GitHubSource, runScan, snapshotFromDirectory, snapshotFromTarball, type EngineConfig, type PreviousReview, type Snapshot } from "@birdsi/engine";
import type { FindingDraft, OpsSummary, ProjectHints, ScanEvent } from "@birdsi/shared";
import { assertWithinSpendCaps, SpendCapError, spendHook } from "./spend";

/** An error written for the person who started the scan; its message is shown as it is. */
export class PlainError extends Error {
  override name = "PlainError";
}

/** What the scan page shows for a failure. Anything not written for people stays in the worker log and the job's last_error. */
function shownError(error: unknown): string {
  if (error instanceof PlainError || error instanceof SpendCapError) return error.message;
  return "The scan stopped because of a problem on birdsI's side. Run it again in a few minutes.";
}

/**
 * Runs one scan job end to end: resolves the code, runs the engine, stores
 * findings and dependencies, and queues the chat embedding job.
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

  // The daily limits are checked again now: a scan can wait in the queue while others spend.
  try {
    await assertWithinSpendCaps(scan.owner_user_id, { fresh: true });
  } catch (error) {
    if (!(error instanceof SpendCapError)) throw error;
    await emit({ type: "scan_failed", error: error.message });
    await updateScan(scanId, { status: "failed", finished_at: new Date().toISOString(), error: error.message });
    return;
  }
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
  const ops = scan.repo_id && scan.owner_user_id ? await opsSummaryFor(scan.repo_id, scan.owner_user_id) : null;
  const previousReview = scan.repo_id ? await previousReviewFor(scan.repo_id) : null;
  try {
    const result = await runScan(config, {
      kind: scan.kind,
      snapshot: async () => {
        snapshot = await resolveSnapshot(config, scan.repo_id, scan.snapshot_id, scan.branch, scan.source);
        if (snapshot.commitSha || snapshot.branch) await updateScan(scanId, { commit_sha: snapshot.commitSha, branch: snapshot.branch ?? scan.branch });
        return snapshot;
      },
      appDescription: scan.app_description,
      projectHints: hints,
      ops,
      previousReview,
      onVendors: async (vendors) => {
        if (scan.repo_id) await replaceVendors(scan.repo_id, scanId, vendors);
      },
      signal: controller.signal,
      onEvent: emit,
      traceMetadata: { scanId, kind: scan.kind, source: scan.source },
      beforeCall: spend.beforeCall,
      onUsage: (u) => recordUsage({ ownerUserId: scan.owner_user_id, scanId, fixId: null, purpose: u.purpose, model: u.model, inputTokens: u.inputTokens, outputTokens: u.outputTokens, costMicrodollars: u.costMicrodollars }),
    });
    const refusal = spend.refusal();
    if (refusal) await emit({ type: "note", text: `This scan stopped early. ${refusal}` });

    assertHeld();
    const rows = await insertFindings(scanId, scan.repo_id, result.findings);
    await insertDependencies(scanId, result.dependencies);
    const idByKey = new Map(rows.map((r) => [r.key, r.id]));
    const summary = { ...result.summary, startWith: result.summary.startWith.map((key) => idByKey.get(key) ?? key) };
    const audit = result.audit ? { ...result.audit, areas: result.audit.areas.map((a) => ({ ...a, findingIds: a.findingIds.map((k) => idByKey.get(k) ?? k) })) } : null;

    if (controller.signal.aborted) {
      assertHeld();
      await emit({ type: "scan_stopped" });
      await updateScan(scanId, { status: "stopped", finished_at: new Date().toISOString(), summary, stats: result.stats });
      return;
    }
    await updateScan(scanId, { status: "done", finished_at: new Date().toISOString(), summary, audit, stats: result.stats });

    if (scan.repo_id) {
      await replaceVendors(scan.repo_id, scanId, result.vendors);
      // Static facts: where each vendor is used, so the ops stage and the dashboard can show it.
      await enqueueJob("embed", { scanId, repoId: scan.repo_id }, { maxAttempts: 1 });
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
  }
}

async function lastEventSeq(scanId: string): Promise<number> {
  const { getDb } = await import("@birdsi/db");
  const { data, error } = await getDb().from("scan_events").select("seq").eq("scan_id", scanId).order("seq", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`lastEventSeq: ${error.message}`);
  return (data as { seq: number } | null)?.seq ?? 0;
}

/** The last finished scan's review index (path to hash) and its review findings by path. */
async function previousReviewFor(repoId: string): Promise<PreviousReview | null> {
  const last = await latestDoneScan(repoId);
  if (!last) return null;
  // Read directly: a deep scan's log runs past the 1,000 rows one request returns.
  const index = await lastEventOfType(last.id, "review_index");
  if (!index || index.type !== "review_index") return null;
  const hashes = new Map(index.files.map((f) => [f.path, f.hash]));
  const findingsByPath = new Map<string, FindingDraft[]>();
  for (const row of await findingsForScan(last.id)) {
    if (row.check_id !== "review" || !row.location?.path || row.status === "fixed") continue;
    const draft: FindingDraft = {
      key: row.key,
      checkId: row.check_id,
      title: row.title,
      explanation: row.explanation,
      whyItMatters: row.why_it_matters,
      severity: row.severity,
      confidence: row.confidence,
      category: row.category,
      location: row.location,
      evidence: row.evidence,
      actionKind: row.action_kind,
      steps: row.steps,
      fixPlan: row.fix_plan,
    };
    findingsByPath.set(row.location.path, [...(findingsByPath.get(row.location.path) ?? []), draft]);
  }
  return { hashes, findingsByPath };
}

/** What earlier syncs learned about the app's services, for the audit's operations area. Null before the first sync. */
async function opsSummaryFor(repoId: string, ownerUserId: string): Promise<OpsSummary | null> {
  const rows = await vendorsForRepo(repoId);
  if (rows.length === 0) return null;
  const [facts, connections, knowledge, history] = await Promise.all([factsForVendors(rows.map((r) => r.id)), connectionsForUser(ownerUserId), knowledgeFor(rows.map((r) => r.slug)), factHistory(rows.map((r) => r.id))]);
  const connected = new Set(connections.map((c) => c.vendor_slug));
  const errors = new Map(connections.filter((c) => c.last_status === "failed" && c.last_error).map((c) => [c.vendor_slug, c.last_error!]));
  const vendors = rows.map((r) => toVendor(r, facts.filter((f) => f.vendor_id === r.id), connected.has(r.slug)));
  const runways = new Map(vendors.map((v) => [v.id, computeRunway(history.get(v.id) ?? [], new Map(v.facts.map((f) => [f.metric, f.label])))]));
  const alerts = computeAlerts(vendors, knowledge, errors, runways);
  const watches = computeWatches(vendors, knowledge);
  const syncedAt = (await (await import("@birdsi/db")).repoWithInstallation(repoId)).repo.vendors_synced_at;
  if (!syncedAt) return null;
  return {
    vendors: vendors.length,
    plansKnown: vendors.filter((v) => v.facts.some((f) => f.kind === "plan")).length,
    connected: vendors.filter((v) => v.connected).length,
    alerts: alerts.map((a) => ({ level: a.level, title: a.title })),
    watches: watches.map((w) => ({ title: w.title })),
    lastSyncAt: syncedAt,
  };
}

/** The bundled sample, found from this file whether running from source or from the built bundle. */
async function demoSamplePath(): Promise<string> {
  const fromEnv = process.env["BIRDSI_DEMO_SAMPLE_PATH"];
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [fromEnv, resolve(here, "../../../samples/corner-bakery"), resolve(here, "../samples/corner-bakery"), resolve(process.cwd(), "samples/corner-bakery")].filter((p): p is string => Boolean(p));
  for (const candidate of candidates) {
    try {
      await access(join(candidate, "package.json"));
      return candidate;
    } catch {
      // try the next
    }
  }
  throw new PlainError("The demo sample repository is missing from this worker.");
}

/** Where the code comes from: the GitHub App, an uploaded CLI snapshot, or the bundled demo sample. */
export async function resolveSnapshot(config: EngineConfig, repoId: string | null, snapshotId: string | null, branch: string | null, source: string): Promise<Snapshot> {
  if (source === "demo") {
    return snapshotFromDirectory(await demoSamplePath(), { fullName: "birdsi-demo/corner-bakery", branch: "main", commitSha: null });
  }
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
    if (installation.suspended_at) throw new PlainError("The GitHub App installation is suspended. Resume it on GitHub, then scan again.");
    if (!GitHubSource.isConfigured(config)) throw new PlainError("The GitHub App is not configured on the server.");
    const [owner, name] = repo.full_name.split("/") as [string, string];
    const github = new GitHubSource(config);
    return github.snapshot({ owner, name, installationId: installation.github_installation_id }, branch ?? repo.default_branch);
  }
  throw new PlainError("The scan has no code source.");
}
