import { auth, currentUser } from "@clerk/nextjs/server";
import { upsertUser, userByClerkId, type UserRow } from "@birdsi/db";
import { cache } from "react";

/**
 * The signed-in user's local row, created on first sight. Cached per request.
 * Returns null when nobody is signed in; pages redirect, API routes 401.
 */
export const currentUserRow = cache(async (): Promise<UserRow | null> => {
  const { userId } = await auth();
  if (!userId) return null;
  const existing = await userByClerkId(userId);
  if (existing) return existing;
  const clerkUser = await currentUser();
  const github = clerkUser?.externalAccounts.find((a) => a.provider.includes("github"));
  return upsertUser({
    clerkUserId: userId,
    githubLogin: github?.username ?? null,
    githubUserId: github ? Number.parseInt(github.providerUserId, 10) || null : null,
    email: clerkUser?.primaryEmailAddress?.emailAddress ?? clerkUser?.emailAddresses[0]?.emailAddress ?? null,
  });
});

export async function requireUser(): Promise<UserRow> {
  const user = await currentUserRow();
  if (!user) throw new Error("Not signed in");
  return user;
}
