import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  appendEvent,
  connectionsForUser,
  downloadSnapshot,
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
  type JobRow,
} from "@birdsi/db";
import { computeAlerts, computeRunway, computeWatches, GitHubSource, runScan, snapshotFromDirectory, snapshotFromTarball, type EngineConfig, type Snapshot } from "@birdsi/engine";
import type { OpsSummary, ProjectHints, ScanEvent } from "@birdsi/shared";

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

  // Stop requests from the UI and job heartbeats share one timer.
  const ticker = setInterval(() => {
    void (async () => {
      try {
        await heartbeat();
        if (await stopRequested(scanId)) controller.abort();
      } catch {
        // Losing a heartbeat is not fatal; the claim function requeues stale jobs.
      }
    })();
  }, 15_000);

  let snapshot: Snapshot | null = null;
  const hints: ProjectHints | null = scan.snapshot_id ? (((await snapshotById(scan.snapshot_id))?.project_hints as ProjectHints | null) ?? null) : null;
  const ops = scan.repo_id && scan.owner_user_id ? await opsSummaryFor(scan.repo_id, scan.owner_user_id) : null;
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
      signal: controller.signal,
      onEvent: emit,
      traceMetadata: { scanId, kind: scan.kind, source: scan.source },
      onUsage: (u) => recordUsage({ ownerUserId: scan.owner_user_id, scanId, fixId: null, purpose: u.purpose, model: u.model, inputTokens: u.inputTokens, outputTokens: u.outputTokens, costMicrodollars: u.costMicrodollars }),
    });

    const rows = await insertFindings(scanId, scan.repo_id, result.findings);
    await insertDependencies(scanId, result.dependencies);
    const idByKey = new Map(rows.map((r) => [r.key, r.id]));
    const summary = { ...result.summary, startWith: result.summary.startWith.map((key) => idByKey.get(key) ?? key) };
    const audit = result.audit ? { ...result.audit, areas: result.audit.areas.map((a) => ({ ...a, findingIds: a.findingIds.map((k) => idByKey.get(k) ?? k) })) } : null;

    if (controller.signal.aborted) {
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
    const message = error instanceof Error ? error.message : String(error);
    if (controller.signal.aborted) {
      await emit({ type: "scan_stopped" });
      await updateScan(scanId, { status: "stopped", finished_at: new Date().toISOString() });
      return;
    }
    await emit({ type: "scan_failed", error: message.slice(0, 500) });
    await updateScan(scanId, { status: "failed", finished_at: new Date().toISOString(), error: message.slice(0, 1000) });
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
  throw new Error("The demo sample repository is missing from this worker.");
}

/** Where the code comes from: the GitHub App, an uploaded CLI snapshot, or the bundled demo sample. */
export async function resolveSnapshot(config: EngineConfig, repoId: string | null, snapshotId: string | null, branch: string | null, source: string): Promise<Snapshot> {
  if (source === "demo") {
    return snapshotFromDirectory(await demoSamplePath(), { fullName: "birdsi-demo/corner-bakery", branch: "main", commitSha: null });
  }
  if (snapshotId) {
    const row = await snapshotById(snapshotId);
    if (!row || !row.uploaded_at) throw new Error("The uploaded code snapshot is missing or incomplete.");
    if (!row.storage_path) throw new Error("The uploaded code was deleted after the retention window (seven days). Run birdsi again to upload it.");
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
    if (!installation || installation.removed_at) throw new Error("The GitHub App is no longer installed for this repository. Reconnect it from Settings.");
    if (installation.suspended_at) throw new Error("The GitHub App installation is suspended. Resume it on GitHub, then scan again.");
    if (!GitHubSource.isConfigured(config)) throw new Error("The GitHub App is not configured on the server.");
    const [owner, name] = repo.full_name.split("/") as [string, string];
    const github = new GitHubSource(config);
    return github.snapshot({ owner, name, installationId: installation.github_installation_id }, branch ?? repo.default_branch);
  }
  throw new Error("The scan has no code source.");
}
