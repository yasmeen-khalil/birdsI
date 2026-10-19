import type { Dependency, Finding, FindingDraft, FindingStatus, Scan, ScanEvent, ScanEventRecord, ScanKind, ScanSource, ScanStats, ScanSummary } from "@birdsi/shared";
import { ForbiddenError, getDb, NotFoundError, unwrap } from "./client";

export interface ScanRow {
  id: string;
  repo_id: string | null;
  snapshot_id: string | null;
  owner_user_id: string | null;
  kind: ScanKind;
  status: Scan["status"];
  source: ScanSource;
  branch: string | null;
  commit_sha: string | null;
  app_description: string | null;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  summary: ScanSummary | null;
  /** The pre-launch audit's report, on audit scans from before v3. */
  audit: unknown;
  stats: ScanStats | null;
  stop_requested_at: string | null;
  created_at: string;
}

export function toScan(row: ScanRow): Scan {
  return {
    id: row.id,
    repoId: row.repo_id,
    kind: row.kind,
    status: row.status,
    source: row.source,
    branch: row.branch,
    commitSha: row.commit_sha,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    error: row.error,
    summary: row.summary,
    stats: row.stats,
    createdAt: row.created_at,
  };
}

export async function createScan(input: { repoId: string | null; snapshotId: string | null; ownerUserId: string | null; source: ScanSource; branch: string | null }): Promise<ScanRow> {
  const db = getDb();
  // Every scan since v3 is a map of the code, stored under the first kind.
  const result = await db
    .from("scans")
    .insert({ repo_id: input.repoId, snapshot_id: input.snapshotId, owner_user_id: input.ownerUserId, kind: "light", source: input.source, branch: input.branch })
    .select()
    .single();
  return unwrap(result, "createScan") as ScanRow;
}

/** Removes a scan that was created but never queued (it lost a race to another scan of the same repository). */
export async function discardScan(scanId: string): Promise<void> {
  const db = getDb();
  const { error } = await db.from("scans").delete().eq("id", scanId).eq("status", "queued");
  if (error) throw new Error(`discardScan: ${error.message}`);
}

export async function scanById(scanId: string): Promise<ScanRow | null> {
  const db = getDb();
  const { data, error } = await db.from("scans").select().eq("id", scanId).maybeSingle();
  if (error) throw new Error(`scanById: ${error.message}`);
  return (data as ScanRow | null) ?? null;
}

/** A scan the caller may read: only their own. Sample scans from the removed demo have no owner and are read by no one. */
export async function scanForViewer(scanId: string, userId: string | null): Promise<ScanRow> {
  const row = await scanById(scanId);
  if (!row) throw new NotFoundError("scan");
  if (!userId || row.owner_user_id !== userId) throw new ForbiddenError("scan");
  return row;
}

export async function scansForRepo(repoId: string, limit = 10): Promise<ScanRow[]> {
  const db = getDb();
  const { data, error } = await db.from("scans").select().eq("repo_id", repoId).order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error(`scansForRepo: ${error.message}`);
  return (data ?? []) as ScanRow[];
}

export async function latestDoneScan(repoId: string, kind?: ScanKind): Promise<ScanRow | null> {
  const db = getDb();
  let query = db.from("scans").select().eq("repo_id", repoId).eq("status", "done").order("created_at", { ascending: false }).limit(1);
  if (kind) query = query.eq("kind", kind);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`latestDoneScan: ${error.message}`);
  return (data as ScanRow | null) ?? null;
}

export async function updateScan(scanId: string, patch: Partial<Pick<ScanRow, "status" | "started_at" | "finished_at" | "error" | "summary" | "stats" | "commit_sha" | "branch" | "stop_requested_at">>): Promise<void> {
  const db = getDb();
  const { error } = await db.from("scans").update(patch).eq("id", scanId);
  if (error) throw new Error(`updateScan: ${error.message}`);
}

export async function requestStop(scanId: string): Promise<void> {
  await updateScan(scanId, { stop_requested_at: new Date().toISOString() });
}

export async function stopRequested(scanId: string): Promise<boolean> {
  const db = getDb();
  const { data, error } = await db.from("scans").select("stop_requested_at").eq("id", scanId).maybeSingle();
  if (error) throw new Error(`stopRequested: ${error.message}`);
  return Boolean((data as { stop_requested_at: string | null } | null)?.stop_requested_at);
}

/** Appends one event; seq is assigned here so the log stays gap-free per scan. */
export async function appendEvent(scanId: string, seq: number, event: ScanEvent): Promise<void> {
  const db = getDb();
  const { error } = await db.from("scan_events").insert({ scan_id: scanId, seq, event });
  if (error) throw new Error(`appendEvent: ${error.message}`);
}

export async function eventsAfter(scanId: string, after: number, limit = 500): Promise<ScanEventRecord[]> {
  const db = getDb();
  const { data, error } = await db.from("scan_events").select("seq, at, event").eq("scan_id", scanId).gt("seq", after).order("seq").limit(limit);
  if (error) throw new Error(`eventsAfter: ${error.message}`);
  return ((data ?? []) as Array<{ seq: number; at: string; event: ScanEvent }>).map((r) => ({ seq: r.seq, at: r.at, event: r.event }));
}

/** The newest event of one type in a scan's log, read directly instead of paging the whole log. */
export async function lastEventOfType(scanId: string, type: ScanEvent["type"]): Promise<ScanEvent | null> {
  const db = getDb();
  const { data, error } = await db.from("scan_events").select("event").eq("scan_id", scanId).eq("event->>type", type).order("seq", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`lastEventOfType: ${error.message}`);
  return (data as { event: ScanEvent } | null)?.event ?? null;
}

export interface FindingRow {
  id: string;
  scan_id: string;
  repo_id: string | null;
  key: string;
  check_id: string;
  title: string;
  explanation: string;
  why_it_matters: string;
  severity: Finding["severity"];
  confidence: Finding["confidence"];
  category: Finding["category"];
  location: Finding["location"];
  evidence: Finding["evidence"];
  action_kind: Finding["actionKind"];
  steps: Finding["steps"];
  fix_plan: Finding["fixPlan"];
  status: FindingStatus;
  created_at: string;
}

export function toFinding(row: FindingRow): Finding {
  return {
    id: row.id,
    scanId: row.scan_id,
    repoId: row.repo_id,
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
    status: row.status,
    createdAt: row.created_at,
  };
}

/** Stores the ranked findings; carried-over statuses (fixed, dismissed) are applied by key. */
export async function insertFindings(scanId: string, repoId: string | null, drafts: FindingDraft[]): Promise<FindingRow[]> {
  if (drafts.length === 0) return [];
  const db = getDb();
  const carried = new Map<string, FindingStatus>();
  if (repoId) {
    const { data, error } = await db.from("finding_states").select("key, status").eq("repo_id", repoId).in("key", drafts.map((d) => d.key));
    if (error) throw new Error(`insertFindings states: ${error.message}`);
    for (const row of (data ?? []) as Array<{ key: string; status: FindingStatus }>) carried.set(row.key, row.status);
  }
  const rows = drafts.map((d) => ({
    scan_id: scanId,
    repo_id: repoId,
    key: d.key,
    check_id: d.checkId,
    title: d.title,
    explanation: d.explanation,
    why_it_matters: d.whyItMatters,
    severity: d.severity,
    confidence: d.confidence,
    category: d.category,
    location: d.location,
    evidence: d.evidence,
    action_kind: d.actionKind,
    steps: d.steps,
    fix_plan: d.fixPlan,
    status: carried.get(d.key) === "dismissed" ? "dismissed" : "open",
  }));
  const result = await db.from("findings").insert(rows).select();
  return unwrap(result, "insertFindings") as FindingRow[];
}

export async function findingsForScan(scanId: string): Promise<FindingRow[]> {
  const db = getDb();
  const { data, error } = await db.from("findings").select().eq("scan_id", scanId).order("created_at");
  if (error) throw new Error(`findingsForScan: ${error.message}`);
  return (data ?? []) as FindingRow[];
}

export async function findingById(findingId: string): Promise<FindingRow | null> {
  const db = getDb();
  const { data, error } = await db.from("findings").select().eq("id", findingId).maybeSingle();
  if (error) throw new Error(`findingById: ${error.message}`);
  return (data as FindingRow | null) ?? null;
}

/** A finding the caller may read, resolved through its scan's ownership. */
export async function findingForViewer(findingId: string, userId: string | null): Promise<{ finding: FindingRow; scan: ScanRow }> {
  const finding = await findingById(findingId);
  if (!finding) throw new NotFoundError("finding");
  const scan = await scanForViewer(finding.scan_id, userId);
  return { finding, scan };
}

export async function setFindingStatus(findingId: string, repoId: string | null, key: string, status: FindingStatus): Promise<void> {
  const db = getDb();
  const { error } = await db.from("findings").update({ status }).eq("id", findingId);
  if (error) throw new Error(`setFindingStatus: ${error.message}`);
  if (repoId) {
    const { error: stateError } = await db.from("finding_states").upsert({ repo_id: repoId, key, status, updated_at: new Date().toISOString() }, { onConflict: "repo_id,key" });
    if (stateError) throw new Error(`setFindingStatus state: ${stateError.message}`);
  }
}

export async function insertDependencies(scanId: string, deps: Dependency[]): Promise<void> {
  if (deps.length === 0) return;
  const db = getDb();
  const rows = deps.map((d) => ({
    scan_id: scanId,
    ecosystem: d.ecosystem,
    name: d.name,
    version_in_use: d.versionInUse,
    latest_version: d.latestVersion,
    manifest_path: d.manifestPath,
    direct: d.direct,
    vulnerabilities: d.vulnerabilities,
    docs_check: d.docsCheck,
  }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from("dependencies").insert(rows.slice(i, i + 500));
    if (error) throw new Error(`insertDependencies: ${error.message}`);
  }
}

export async function dependenciesForScan(scanId: string): Promise<Dependency[]> {
  const db = getDb();
  const { data, error } = await db.from("dependencies").select().eq("scan_id", scanId).order("name");
  if (error) throw new Error(`dependenciesForScan: ${error.message}`);
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    ecosystem: r["ecosystem"] as Dependency["ecosystem"],
    name: r["name"] as string,
    versionInUse: r["version_in_use"] as string,
    latestVersion: (r["latest_version"] as string | null) ?? null,
    manifestPath: r["manifest_path"] as string,
    direct: r["direct"] as boolean,
    vulnerabilities: (r["vulnerabilities"] as Dependency["vulnerabilities"]) ?? [],
    docsCheck: (r["docs_check"] as Dependency["docsCheck"]) ?? null,
  }));
}
