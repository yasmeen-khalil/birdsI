import { auth, currentUser } from "@clerk/nextjs/server";
import { decideAccess, upsertUser, userByClerkId, type UserRow } from "@birdsi/db";
import { cache } from "react";
import { AccessError, approvedAtSignIn, hasAccess } from "./access";

/**
 * Whoever is signed in, approved or not, with their local row created on
 * first sight. Cached per request. Only the sign-in gate itself uses this:
 * the page where a person asks for access, and the checks below. Everything
 * else calls currentUserRow or requireUser, which need an approved account.
 * The owner's row, and while access is open a pending row, is approved here.
 */
export const signedInUserUngated = cache(async (): Promise<UserRow | null> => {
  const { userId } = await auth();
  if (!userId) return null;
  const user = (await userByClerkId(userId)) ?? (await createUser(userId));
  if (!approvedAtSignIn(user)) return user;
  await decideAccess(user.id, "approved");
  return { ...user, access: "approved" };
});

async function createUser(clerkUserId: string): Promise<UserRow> {
  const clerkUser = await currentUser();
  const github = clerkUser?.externalAccounts.find((a) => a.provider.includes("github"));
  return upsertUser({
    clerkUserId,
    githubLogin: github?.username ?? null,
    githubUserId: github ? Number.parseInt(github.providerUserId, 10) || null : null,
    email: clerkUser?.primaryEmailAddress?.emailAddress ?? clerkUser?.emailAddresses[0]?.emailAddress ?? null,
  });
}

/**
 * The signed-in user when their account is approved, null otherwise. To a
 * caller, an account waiting for approval looks like nobody is signed in.
 */
export const currentUserRow = cache(async (): Promise<UserRow | null> => {
  const user = await signedInUserUngated();
  return user && hasAccess(user) ? user : null;
});

/** For server actions: an approved account, or an error. */
export async function requireUser(): Promise<UserRow> {
  const user = await signedInUserUngated();
  if (!user) throw new Error("Not signed in");
  if (!hasAccess(user)) throw new AccessError();
  return user;
}
