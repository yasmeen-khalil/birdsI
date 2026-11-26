import type { UserRow } from "@birdsi/db";

/**
 * Access by approval. An account that is not approved can sign in and ask
 * for access, and nothing else: no page of the app, no API call, no server
 * action. Every check goes through hasAccess, and anything it cannot read
 * as approved is refused.
 */
export class AccessError extends Error {
  override name = "AccessError";
  constructor() {
    super("This account is not approved yet.");
  }
}

export const ACCESS_PENDING_MESSAGE = "Your access is waiting for approval. Open birdsI in the browser to see where your request stands.";

/** The owners' GitHub user ids from BIRDSI_OWNER_GITHUB_IDS, numbers separated by commas. A GitHub id never changes, a login can. */
export function ownerIds(raw: string | undefined | null): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => /^[0-9]+$/.test(s)),
  );
}

/** The owner approves and denies requests, and is never locked out. */
export function isOwner(user: Pick<UserRow, "github_user_id" | "deleted_at">, raw: string | undefined | null = process.env["BIRDSI_OWNER_GITHUB_IDS"]): boolean {
  if (user.deleted_at) return false;
  if (user.github_user_id === null || user.github_user_id === undefined) return false;
  return ownerIds(raw).has(String(user.github_user_id));
}

export function hasAccess(user: Pick<UserRow, "access" | "github_user_id" | "deleted_at">, raw: string | undefined | null = process.env["BIRDSI_OWNER_GITHUB_IDS"]): boolean {
  if (user.deleted_at) return false;
  return user.access === "approved" || isOwner(user, raw);
}

/** BIRDSI_ACCESS=open: an account is approved when it first signs in. Unset or anything else keeps access by approval. */
export function accessIsOpen(raw: string | undefined | null = process.env["BIRDSI_ACCESS"]): boolean {
  return raw?.trim().toLowerCase() === "open";
}

/**
 * True when the sign-in marks this row approved. An owner's own row that is not
 * approved yet, as on a new database where every account starts pending: the
 * worker schedules approved rows and never reads BIRDSI_OWNER_GITHUB_IDS. And
 * while access is open, a pending row. A denied row stays denied either way.
 */
export function approvedAtSignIn(
  user: Pick<UserRow, "access" | "github_user_id" | "deleted_at">,
  owners: string | undefined | null = process.env["BIRDSI_OWNER_GITHUB_IDS"],
  access: string | undefined | null = process.env["BIRDSI_ACCESS"],
): boolean {
  if (user.deleted_at || user.access === "approved") return false;
  if (isOwner(user, owners)) return true;
  return user.access === "pending" && accessIsOpen(access);
}
