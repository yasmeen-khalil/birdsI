import { createHash, randomBytes } from "node:crypto";
import { getDb, unwrap } from "./client";

export interface ApiTokenRow {
  id: string;
  owner_user_id: string;
  token_hash: string;
  name: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

const TOKEN_PREFIX = "bsi_";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Mints a token for the CLI or MCP server. The plain value is returned once and never stored. */
export async function createApiToken(userId: string, name: string, ttlDays = 90): Promise<{ token: string; row: ApiTokenRow }> {
  const token = TOKEN_PREFIX + randomBytes(32).toString("base64url");
  const db = getDb();
  const result = await db
    .from("api_tokens")
    .insert({ owner_user_id: userId, token_hash: hashToken(token), name, expires_at: new Date(Date.now() + ttlDays * 86_400_000).toISOString() })
    .select()
    .single();
  return { token, row: unwrap(result, "createApiToken") as ApiTokenRow };
}

/** Resolves a bearer token to its owner, or null. Updates last_used_at at most once a minute. */
export async function userIdForToken(token: string): Promise<string | null> {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const db = getDb();
  const { data, error } = await db.from("api_tokens").select().eq("token_hash", hashToken(token)).maybeSingle();
  if (error) throw new Error(`userIdForToken: ${error.message}`);
  const row = data as ApiTokenRow | null;
  if (!row || row.revoked_at) return null;
  if (row.expires_at && new Date(row.expires_at) < new Date()) return null;
  const lastUsed = row.last_used_at ? new Date(row.last_used_at).getTime() : 0;
  if (Date.now() - lastUsed > 60_000) {
    await db.from("api_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", row.id);
  }
  const user = await db.from("users").select("id").eq("id", row.owner_user_id).is("deleted_at", null).maybeSingle();
  if (user.error || !user.data) return null;
  return row.owner_user_id;
}

export async function tokensForUser(userId: string): Promise<ApiTokenRow[]> {
  const db = getDb();
  const { data, error } = await db.from("api_tokens").select().eq("owner_user_id", userId).is("revoked_at", null).order("created_at", { ascending: false });
  if (error) throw new Error(`tokensForUser: ${error.message}`);
  return (data ?? []) as ApiTokenRow[];
}

export async function revokeToken(tokenId: string, userId: string): Promise<void> {
  const db = getDb();
  const { error } = await db.from("api_tokens").update({ revoked_at: new Date().toISOString() }).eq("id", tokenId).eq("owner_user_id", userId);
  if (error) throw new Error(`revokeToken: ${error.message}`);
}

// Device-code sign-in for the CLI.

export interface DeviceLoginRow {
  id: string;
  device_code_hash: string;
  user_code: string;
  status: "pending" | "approved" | "denied" | "expired" | "claimed";
  approved_by: string | null;
  token_id: string | null;
  token_plain: string | null;
  expires_at: string;
  created_at: string;
}

const USER_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ23456789";

function makeUserCode(): string {
  const bytes = randomBytes(8);
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += USER_CODE_ALPHABET[bytes[i]! % USER_CODE_ALPHABET.length];
    if (i === 3) code += "-";
  }
  return code;
}

export async function startDeviceLogin(): Promise<{ deviceCode: string; userCode: string; expiresAt: string }> {
  const deviceCode = randomBytes(32).toString("base64url");
  const db = getDb();
  for (let attempt = 0; attempt < 5; attempt++) {
    const userCode = makeUserCode();
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    const { error } = await db.from("device_logins").insert({ device_code_hash: hashToken(deviceCode), user_code: userCode, expires_at: expiresAt });
    if (!error) return { deviceCode, userCode, expiresAt };
    if (!/duplicate/i.test(error.message)) throw new Error(`startDeviceLogin: ${error.message}`);
  }
  throw new Error("startDeviceLogin: could not allocate a code");
}

export async function deviceLoginByUserCode(userCode: string): Promise<DeviceLoginRow | null> {
  const db = getDb();
  const { data, error } = await db.from("device_logins").select().eq("user_code", userCode.toUpperCase().trim()).maybeSingle();
  if (error) throw new Error(`deviceLoginByUserCode: ${error.message}`);
  return (data as DeviceLoginRow | null) ?? null;
}

/** The signed-in user approves the code shown in their terminal. */
export async function approveDeviceLogin(userCode: string, userId: string, tokenName: string): Promise<"approved" | "expired" | "not_found" | "already_used"> {
  const row = await deviceLoginByUserCode(userCode);
  if (!row) return "not_found";
  // Approving twice (a double click, a refresh) is the same approval.
  if ((row.status === "approved" || row.status === "claimed") && row.approved_by === userId) return "approved";
  if (row.status !== "pending") return "already_used";
  if (new Date(row.expires_at) < new Date()) return "expired";
  const { token, row: tokenRow } = await createApiToken(userId, tokenName);
  const db = getDb();
  const { error } = await db.from("device_logins").update({ status: "approved", approved_by: userId, token_id: tokenRow.id, token_plain: token }).eq("id", row.id).eq("status", "pending");
  if (error) throw new Error(`approveDeviceLogin: ${error.message}`);
  return "approved";
}

export async function denyDeviceLogin(userCode: string): Promise<void> {
  const db = getDb();
  const { error } = await db.from("device_logins").update({ status: "denied" }).eq("user_code", userCode.toUpperCase().trim()).eq("status", "pending");
  if (error) throw new Error(`denyDeviceLogin: ${error.message}`);
}

/** The CLI polls with its device code; the token is handed over exactly once. */
export async function pollDeviceLogin(deviceCode: string): Promise<{ status: "pending" | "expired" | "denied" } | { status: "approved"; token: string; userId: string }> {
  const db = getDb();
  const { data, error } = await db.from("device_logins").select().eq("device_code_hash", hashToken(deviceCode)).maybeSingle();
  if (error) throw new Error(`pollDeviceLogin: ${error.message}`);
  const row = data as DeviceLoginRow | null;
  if (!row) return { status: "expired" };
  if (row.status === "denied") return { status: "denied" };
  if (row.status === "claimed" || row.status === "expired") return { status: "expired" };
  if (new Date(row.expires_at) < new Date()) return { status: "expired" };
  if (row.status === "pending") return { status: "pending" };
  if (!row.token_plain || !row.approved_by) return { status: "expired" };
  const claim = await db.from("device_logins").update({ status: "claimed", token_plain: null }).eq("id", row.id).eq("status", "approved").select("id");
  if (claim.error) throw new Error(`pollDeviceLogin claim: ${claim.error.message}`);
  if (!claim.data || claim.data.length === 0) return { status: "expired" };
  return { status: "approved", token: row.token_plain, userId: row.approved_by };
}
