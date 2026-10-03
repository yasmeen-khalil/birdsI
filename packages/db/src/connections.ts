import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getDb, ForbiddenError, NotFoundError, unwrap } from "./client";

/**
 * Vendor account tokens the owner gives birdsI, encrypted at rest with
 * AES-256-GCM under BIRDSI_SECRETS_KEY. The plain token exists only in
 * server memory while a connector runs.
 */
export interface ConnectionRow {
  id: string;
  owner_user_id: string;
  vendor_slug: string;
  label: string | null;
  token_ciphertext: string;
  settings: Record<string, string>;
  last_probed_at: string | null;
  last_status: string | null;
  last_error: string | null;
  created_at: string;
}

function key(): Buffer {
  const raw = process.env["BIRDSI_SECRETS_KEY"];
  if (!raw || raw.trim().length < 16) {
    throw new Error("BIRDSI_SECRETS_KEY is not set. Add a long random string to .env.local and the hosting environment; it encrypts connected account tokens.");
  }
  return createHash("sha256").update(raw.trim()).digest();
}

export function isSecretsKeyConfigured(): boolean {
  const raw = process.env["BIRDSI_SECRETS_KEY"];
  return Boolean(raw && raw.trim().length >= 16);
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptSecret(ciphertext: string): string {
  const [version, ivB64, tagB64, dataB64] = ciphertext.split(".");
  if (version !== "v1" || !ivB64 || !tagB64 || !dataB64) throw new Error("Unrecognised secret format");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64url")), decipher.final()]).toString("utf8");
}

export async function saveConnection(userId: string, input: { vendorSlug: string; token: string; label: string | null; settings: Record<string, string> }): Promise<ConnectionRow> {
  const db = getDb();
  const result = await db
    .from("connections")
    .upsert(
      { owner_user_id: userId, vendor_slug: input.vendorSlug, token_ciphertext: encryptSecret(input.token), label: input.label, settings: input.settings, last_probed_at: null, last_status: null, last_error: null },
      { onConflict: "owner_user_id,vendor_slug" },
    )
    .select()
    .single();
  return unwrap(result, "saveConnection") as ConnectionRow;
}

export async function connectionsForUser(userId: string): Promise<ConnectionRow[]> {
  const db = getDb();
  const { data, error } = await db.from("connections").select().eq("owner_user_id", userId).order("vendor_slug");
  if (error) throw new Error(`connectionsForUser: ${error.message}`);
  return (data ?? []) as ConnectionRow[];
}

export async function deleteConnection(connectionId: string, userId: string): Promise<void> {
  const db = getDb();
  const { data, error } = await db.from("connections").select("owner_user_id").eq("id", connectionId).maybeSingle();
  if (error) throw new Error(`deleteConnection: ${error.message}`);
  const row = data as { owner_user_id: string } | null;
  if (!row) throw new NotFoundError("connection");
  if (row.owner_user_id !== userId) throw new ForbiddenError("connection");
  const { error: delError } = await db.from("connections").delete().eq("id", connectionId);
  if (delError) throw new Error(`deleteConnection: ${delError.message}`);
}

export async function markConnectionProbed(connectionId: string, status: "ok" | "failed", error: string | null): Promise<void> {
  const db = getDb();
  const { error: err } = await db.from("connections").update({ last_probed_at: new Date().toISOString(), last_status: status, last_error: error ? error.slice(0, 500) : null }).eq("id", connectionId);
  if (err) throw new Error(`markConnectionProbed: ${err.message}`);
}
