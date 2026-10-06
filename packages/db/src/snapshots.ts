import { getDb, ForbiddenError, NotFoundError, unwrap } from "./client";

export interface SnapshotRow {
  id: string;
  owner_user_id: string;
  storage_path: string;
  full_name: string | null;
  branch: string | null;
  commit_sha: string | null;
  bytes: number | null;
  project_hints: Record<string, unknown> | null;
  uploaded_at: string | null;
  created_at: string;
}

const BUCKET = "snapshots";

/** Registers an upload and returns a signed URL the CLI PUTs the tarball to. */
export async function createSnapshotUpload(userId: string, meta: { fullName: string | null; branch: string | null; commitSha: string | null }): Promise<{ row: SnapshotRow; uploadUrl: string; token: string }> {
  const db = getDb();
  const inserted = await db.from("snapshots").insert({ owner_user_id: userId, storage_path: "", full_name: meta.fullName, branch: meta.branch, commit_sha: meta.commitSha }).select().single();
  const row = unwrap(inserted, "createSnapshotUpload") as SnapshotRow;
  const storagePath = `${userId}/${row.id}.tgz`;
  const { error } = await db.from("snapshots").update({ storage_path: storagePath }).eq("id", row.id);
  if (error) throw new Error(`createSnapshotUpload: ${error.message}`);
  const signed = await db.storage.from(BUCKET).createSignedUploadUrl(storagePath);
  if (signed.error) throw new Error(`createSnapshotUpload sign: ${signed.error.message}`);
  return { row: { ...row, storage_path: storagePath }, uploadUrl: signed.data.signedUrl, token: signed.data.token };
}

export async function markSnapshotUploaded(snapshotId: string, userId: string, bytes: number | null, hints: Record<string, unknown> | null = null): Promise<SnapshotRow> {
  const db = getDb();
  const { data, error } = await db.from("snapshots").select().eq("id", snapshotId).maybeSingle();
  if (error) throw new Error(`markSnapshotUploaded: ${error.message}`);
  const row = data as SnapshotRow | null;
  if (!row) throw new NotFoundError("snapshot");
  if (row.owner_user_id !== userId) throw new ForbiddenError("snapshot");
  const { error: updateError } = await db.from("snapshots").update({ uploaded_at: new Date().toISOString(), bytes, ...(hints ? { project_hints: hints } : {}) }).eq("id", snapshotId);
  if (updateError) throw new Error(`markSnapshotUploaded: ${updateError.message}`);
  return { ...row, uploaded_at: new Date().toISOString(), bytes, project_hints: hints ?? row.project_hints };
}

export async function snapshotForUser(snapshotId: string, userId: string): Promise<SnapshotRow> {
  const db = getDb();
  const { data, error } = await db.from("snapshots").select().eq("id", snapshotId).maybeSingle();
  if (error) throw new Error(`snapshotForUser: ${error.message}`);
  const row = data as SnapshotRow | null;
  if (!row) throw new NotFoundError("snapshot");
  if (row.owner_user_id !== userId) throw new ForbiddenError("snapshot");
  return row;
}

export async function snapshotById(snapshotId: string): Promise<SnapshotRow | null> {
  const db = getDb();
  const { data, error } = await db.from("snapshots").select().eq("id", snapshotId).maybeSingle();
  if (error) throw new Error(`snapshotById: ${error.message}`);
  return (data as SnapshotRow | null) ?? null;
}

/** Downloads the tarball to a local path for the worker. */
export async function downloadSnapshot(row: SnapshotRow, toPath: string): Promise<void> {
  const db = getDb();
  const { data, error } = await db.storage.from(BUCKET).download(row.storage_path);
  if (error || !data) throw new Error(`downloadSnapshot: ${error?.message ?? "no data"}`);
  const { writeFile } = await import("node:fs/promises");
  await writeFile(toPath, Buffer.from(await data.arrayBuffer()));
}

export async function deleteSnapshotFile(row: SnapshotRow): Promise<void> {
  const db = getDb();
  await db.storage.from(BUCKET).remove([row.storage_path]);
}

/** Removes every stored snapshot file of a user; the rows keep an empty path. Used when the account is deleted. */
export async function purgeSnapshotsForUser(userId: string): Promise<number> {
  const db = getDb();
  let removed = 0;
  for (;;) {
    const { data, error } = await db.storage.from(BUCKET).list(userId, { limit: 100 });
    if (error) throw new Error(`purgeSnapshotsForUser list: ${error.message}`);
    const names = (data ?? []).map((f) => `${userId}/${f.name}`);
    if (names.length === 0) break;
    const { error: rmError } = await db.storage.from(BUCKET).remove(names);
    if (rmError) throw new Error(`purgeSnapshotsForUser remove: ${rmError.message}`);
    removed += names.length;
    if (names.length < 100) break;
  }
  const { error: rowError } = await db.from("snapshots").update({ storage_path: "" }).eq("owner_user_id", userId);
  if (rowError) throw new Error(`purgeSnapshotsForUser rows: ${rowError.message}`);
  return removed;
}

/** Deletes snapshot files older than the retention window, in small batches. Returns how many were removed. */
export async function purgeOldSnapshots(retentionDays = 7, batch = 50): Promise<number> {
  const db = getDb();
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
  const { data, error } = await db.from("snapshots").select("id, storage_path").neq("storage_path", "").lt("created_at", cutoff).limit(batch);
  if (error) throw new Error(`purgeOldSnapshots: ${error.message}`);
  const rows = (data ?? []) as Array<{ id: string; storage_path: string }>;
  if (rows.length === 0) return 0;
  const { error: rmError } = await db.storage.from(BUCKET).remove(rows.map((r) => r.storage_path));
  if (rmError) throw new Error(`purgeOldSnapshots remove: ${rmError.message}`);
  const { error: upError } = await db.from("snapshots").update({ storage_path: "" }).in("id", rows.map((r) => r.id));
  if (upError) throw new Error(`purgeOldSnapshots rows: ${upError.message}`);
  return rows.length;
}
