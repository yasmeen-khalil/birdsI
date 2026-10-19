import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Scan, ScanEventRecord, ScanEventsResponse, ScanStatus } from "@birdsi/shared";
import { ApiClient, delay, isTransient, type Result } from "./api";
import { readConfig, updateConfig } from "./config";
import { CliError, EXIT } from "./exit";
import { orderFindings } from "./format";
import { readGitInfo, type GitInfo } from "./git";
import { buildSnapshot, formatBytes, type WalkResult } from "./snapshot";
import { collectHints } from "./hints";

export const TERMINAL_SCAN: readonly ScanStatus[] = ["done", "failed", "stopped"];

export interface SentSnapshot {
  snapshotId: string;
  git: GitInfo | null;
  branch: string | undefined;
  walk: WalkResult;
  bytes: number;
}

export type SnapshotStage =
  | { stage: "packing" }
  | { stage: "uploading"; files: number; bytes: number }
  | { stage: "uploaded" };

/** Packs a local folder, uploads it, and marks the snapshot complete. */
export async function sendSnapshot(
  api: ApiClient,
  path: string,
  options: { branch?: string; onStage?: (stage: SnapshotStage) => void } = {},
): Promise<SentSnapshot> {
  api.requireAuth();
  const root = resolve(path);
  const git = await readGitInfo(root);
  const branch = options.branch ?? git?.branch ?? undefined;
  options.onStage?.({ stage: "packing" });
  const snapshot = await buildSnapshot(root);
  try {
    const body: { fullName?: string; branch?: string; commitSha?: string } = {};
    if (git?.remote && git.remote.host === "github.com") body.fullName = git.remote.fullName;
    if (branch) body.branch = branch;
    if (git?.commitSha) body.commitSha = git.commitSha;
    const created = (await api.createSnapshot(body)).data;
    if (snapshot.bytes > created.maxBytes) {
      throw new CliError(
        `The packed files are ${formatBytes(snapshot.bytes)}, over the ${formatBytes(created.maxBytes)} birdsI accepts in one map.`,
        EXIT.usage,
        "Map a smaller folder, or add large data files to .gitignore.",
      );
    }
    options.onStage?.({ stage: "uploading", files: snapshot.walk.files.length, bytes: snapshot.bytes });
    const bytes = await readFile(snapshot.file);
    await api.uploadSnapshot(created.uploadUrl, bytes);
    // Facts that live only on this machine (Stripe Projects state and spend) ride along.
    const hints = await collectHints(root);
    await api.completeSnapshot(created.snapshotId, snapshot.bytes, hints);
    options.onStage?.({ stage: "uploaded" });
    return { snapshotId: created.snapshotId, git, branch, walk: snapshot.walk, bytes: snapshot.bytes };
  } finally {
    await snapshot.cleanup();
  }
}

/** Starts a map of an uploaded snapshot. */
export async function startScan(api: ApiClient, input: { snapshotId: string; branch?: string | undefined }): Promise<Scan & { dashboardUrl?: string }> {
  const created = (
    await api.createScan({
      snapshotId: input.snapshotId,
      ...(input.branch ? { branch: input.branch } : {}),
    })
  ).data;
  const scan = created.scan;
  await updateConfig({ lastScanId: scan.id, ...(scan.repoId ? { lastRepoId: scan.repoId } : {}) }).catch(() => undefined);
  return { ...scan, ...(created.dashboardUrl ? { dashboardUrl: created.dashboardUrl } : {}) };
}

/** Calls fn, retrying transient failures (network blips, 5xx, 429) with backoff. */
export async function withRetry<T>(fn: () => Promise<T>, options: { attempts?: number; signal?: AbortSignal } = {}): Promise<T> {
  const attempts = options.attempts ?? 6;
  let wait = 1000;
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i >= attempts || !isTransient(error) || options.signal?.aborted) throw error;
      await delay(wait, options.signal);
      wait = Math.min(wait * 2, 15_000);
    }
  }
}

/**
 * Polls the event log every 2 seconds until the scan ends, handing each
 * batch of new events to onEvents. Resolves with the final status, or
 * "running" if the signal aborted first.
 */
export async function followScan(
  api: ApiClient,
  scanId: string,
  options: {
    onEvents: (events: ScanEventRecord[]) => void;
    /** Each poll: when a worker last reported in (null when unknown) and the scan's status. */
    onPresence?: (workerSeenAt: string | null, status: ScanStatus) => void;
    onTick?: () => void;
    signal?: AbortSignal;
    intervalMs?: number;
    /** Give up waiting after this long; resolves with the status at that point. */
    timeoutMs?: number;
  },
): Promise<ScanStatus> {
  const interval = options.intervalMs ?? 2000;
  const deadline = options.timeoutMs ? Date.now() + options.timeoutMs : Infinity;
  let cursor = 0;
  for (;;) {
    const page: Result<ScanEventsResponse> = await withRetry(
      () => api.scanEvents(scanId, cursor),
      options.signal ? { signal: options.signal } : {},
    );
    const { events, status } = page.data;
    cursor = Math.max(cursor, page.data.cursor);
    if (events.length > 0) options.onEvents(events);
    options.onPresence?.(page.data.workerSeenAt ?? null, status);
    if (TERMINAL_SCAN.includes(status)) {
      // One more read, so events written just before the status changed are not lost.
      if (events.length > 0) {
        const tail = await withRetry(() => api.scanEvents(scanId, cursor)).catch(() => null);
        if (tail && tail.data.events.length > 0) options.onEvents(tail.data.events);
      }
      return status;
    }
    if (options.signal?.aborted || Date.now() > deadline) return status;
    options.onTick?.();
    await delay(interval, options.signal);
    if (options.signal?.aborted) return status;
  }
}

/**
 * A finding reference is either a finding id or the number shown next to
 * it in the newest map run from this computer ("birdsi explain 3").
 */
export async function resolveFindingRef(api: ApiClient, ref: string): Promise<{ findingId: string; number?: number }> {
  const trimmed = ref.trim();
  if (!/^\d{1,4}$/.test(trimmed)) return { findingId: trimmed };
  const config = await readConfig();
  if (!config.lastScanId) {
    throw new CliError(
      `There is no recent map to take finding ${trimmed} from.`,
      EXIT.usage,
      "Run birdsi first, or pass the finding id.",
    );
  }
  const scan = (await api.scan(config.lastScanId)).data;
  const ordered = orderFindings(scan.findings);
  const n = Number(trimmed);
  const finding = ordered[n - 1];
  if (!finding) {
    throw new CliError(
      `The newest map has ${ordered.length} ${ordered.length === 1 ? "finding" : "findings"}, so there is no number ${n}.`,
      EXIT.usage,
      "See them all: birdsi findings",
    );
  }
  return { findingId: finding.id, number: n };
}
