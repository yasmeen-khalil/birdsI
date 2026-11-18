import { getDb, unwrap } from "./client";

export interface UserRow {
  id: string;
  clerk_user_id: string;
  github_login: string | null;
  github_user_id: number | null;
  email: string | null;
  email_updates: boolean;
  created_at: string;
  deleted_at: string | null;
  /** Only an approved account can use birdsI. A new account starts as pending. */
  access: UserAccess;
  access_requested_at: string | null;
  access_decided_at: string | null;
}

export type UserAccess = "pending" | "approved" | "denied";

/** Creates or refreshes the local user for a Clerk identity. */
export async function upsertUser(input: { clerkUserId: string; githubLogin: string | null; githubUserId: number | null; email: string | null }): Promise<UserRow> {
  const db = getDb();
  const result = await db
    .from("users")
    .upsert(
      { clerk_user_id: input.clerkUserId, github_login: input.githubLogin, github_user_id: input.githubUserId, email: input.email, deleted_at: null },
      { onConflict: "clerk_user_id" },
    )
    .select()
    .single();
  return unwrap(result, "upsertUser") as UserRow;
}

export async function userByClerkId(clerkUserId: string): Promise<UserRow | null> {
  const db = getDb();
  const { data, error } = await db.from("users").select().eq("clerk_user_id", clerkUserId).is("deleted_at", null).maybeSingle();
  if (error) throw new Error(`userByClerkId: ${error.message}`);
  return (data as UserRow | null) ?? null;
}

export async function userById(id: string): Promise<UserRow | null> {
  const db = getDb();
  const { data, error } = await db.from("users").select().eq("id", id).is("deleted_at", null).maybeSingle();
  if (error) throw new Error(`userById: ${error.message}`);
  return (data as UserRow | null) ?? null;
}

/** A pending account asks for access. Asking twice changes nothing, and a decided account is left as it is. */
export async function requestAccess(userId: string): Promise<void> {
  const db = getDb();
  const { error } = await db.from("users").update({ access_requested_at: new Date().toISOString() }).eq("id", userId).eq("access", "pending").is("access_requested_at", null);
  if (error) throw new Error(`requestAccess: ${error.message}`);
}

/** Every account that asked for access or was decided, newest request first. For the owner's page only. */
export async function accessList(): Promise<UserRow[]> {
  const db = getDb();
  const { data, error } = await db.from("users").select().is("deleted_at", null).or("access_requested_at.not.is.null,access.neq.pending").order("access_requested_at", { ascending: false, nullsFirst: false }).limit(500);
  if (error) throw new Error(`accessList: ${error.message}`);
  return (data ?? []) as UserRow[];
}

/** How many accounts are waiting for the owner's decision. */
export async function accessWaitingCount(): Promise<number> {
  const db = getDb();
  const { count, error } = await db.from("users").select("id", { count: "exact", head: true }).is("deleted_at", null).eq("access", "pending").not("access_requested_at", "is", null);
  if (error) throw new Error(`accessWaitingCount: ${error.message}`);
  return count ?? 0;
}

/** The owner's decision on one account. Returns false when no such account exists. */
export async function decideAccess(userId: string, access: "approved" | "denied"): Promise<boolean> {
  const db = getDb();
  const { data, error } = await db.from("users").update({ access, access_decided_at: new Date().toISOString() }).eq("id", userId).is("deleted_at", null).select("id");
  if (error) throw new Error(`decideAccess: ${error.message}`);
  return (data ?? []).length > 0;
}

/** The ids of the approved accounts, for the worker's schedule. */
export async function approvedUserIds(): Promise<string[]> {
  const db = getDb();
  const { data, error } = await db.from("users").select("id").eq("access", "approved").is("deleted_at", null).limit(10000);
  if (error) throw new Error(`approvedUserIds: ${error.message}`);
  return ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
}

export async function updateUserPreferences(userId: string, prefs: { emailUpdates?: boolean }): Promise<void> {
  const db = getDb();
  const patch: Record<string, unknown> = {};
  if (prefs.emailUpdates !== undefined) patch["email_updates"] = prefs.emailUpdates;
  const { error } = await db.from("users").update(patch).eq("id", userId);
  if (error) throw new Error(`updateUserPreferences: ${error.message}`);
}

/**
 * Deletes everything the user owns, then keeps the user row itself as an
 * empty shell: no name, no email, only the sign-in id, marked deleted. The
 * usage ledger stays attached to it, so signing in again with the same
 * identity returns to the same row and today's spending limits still count
 * what was already spent. Children are removed explicitly, in the order the
 * foreign keys need, because the cascades only fire on a hard delete.
 */
export async function deleteUser(userId: string): Promise<void> {
  const db = getDb();
  const steps: Array<[string, () => PromiseLike<{ error: { message: string } | null }>]> = [
    // Repositories cascade to their scans, findings, vendors, questions, approvals and record.
    ["repos", () => db.from("repos").delete().eq("owner_user_id", userId)],
    ["scans", () => db.from("scans").delete().eq("owner_user_id", userId)],
    ["snapshots", () => db.from("snapshots").delete().eq("owner_user_id", userId)],
    // Chat and fixes were removed in v3; their tables keep rows from before, which still go with the account.
    ["chat_messages", () => db.from("chat_messages").delete().eq("owner_user_id", userId)],
    ["api_tokens", () => db.from("api_tokens").delete().eq("owner_user_id", userId)],
    ["device_logins", () => db.from("device_logins").delete().eq("approved_by", userId)],
    ["connections", () => db.from("connections").delete().eq("owner_user_id", userId)],
    ["installations", () => db.from("installations").update({ connected_by: null }).eq("connected_by", userId)],
    ["action_requests", () => db.from("action_requests").update({ decided_by: null }).eq("decided_by", userId)],
    ["fixes", () => db.from("fixes").update({ requested_by: null }).eq("requested_by", userId)],
    [
      "users",
      () => db.from("users").update({ github_login: null, github_user_id: null, email: null, email_updates: false, deleted_at: new Date().toISOString() }).eq("id", userId),
    ],
  ];
  for (const [table, run] of steps) {
    const { error } = await run();
    if (error) throw new Error(`deleteUser ${table}: ${error.message}`);
  }
}
