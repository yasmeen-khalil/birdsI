import { getDb, ForbiddenError, NotFoundError, unwrap } from "./client";

export interface SnapshotRow {
  id: string;
  owner_user_id: string;
  storage_path: string;
  full_name: string | null;
  branch: string | null;
  commit_sha: string | null;
  bytes: number | null;
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

export async function markSnapshotUploaded(snapshotId: string, userId: string, bytes: number | null): Promise<SnapshotRow> {
  const db = getDb();
  const { data, error } = await db.from("snapshots").select().eq("id", snapshotId).maybeSingle();
  if (error) throw new Error(`markSnapshotUploaded: ${error.message}`);
  const row = data as SnapshotRow | null;
  if (!row) throw new NotFoundError("snapshot");
  if (row.owner_user_id !== userId) throw new ForbiddenError("snapshot");
  const { error: updateError } = await db.from("snapshots").update({ uploaded_at: new Date().toISOString(), bytes }).eq("id", snapshotId);
  if (updateError) throw new Error(`markSnapshotUploaded: ${updateError.message}`);
  return { ...row, uploaded_at: new Date().toISOString(), bytes };
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
