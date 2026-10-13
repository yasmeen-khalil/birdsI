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
}

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
    // Repositories cascade to their scans, findings, vendors, questions, approvals, record and chat.
    ["repos", () => db.from("repos").delete().eq("owner_user_id", userId)],
    ["scans", () => db.from("scans").delete().eq("owner_user_id", userId)],
    ["snapshots", () => db.from("snapshots").delete().eq("owner_user_id", userId)],
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
