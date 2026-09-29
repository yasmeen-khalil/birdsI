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
 * Deletes everything the user owns. Repos, scans, findings, fixes, tokens
 * and chat cascade from the user row; the ledger keeps its rows with the
 * owner set to null so cost history stays true.
 */
export async function deleteUser(userId: string): Promise<void> {
  const db = getDb();
  const { error } = await db.from("users").delete().eq("id", userId);
  if (error) throw new Error(`deleteUser: ${error.message}`);
}
