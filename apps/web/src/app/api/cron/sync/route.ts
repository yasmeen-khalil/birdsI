import { enqueueJob, jobActive, reposDueForSync } from "@birdsi/db";
import { ApiError, handler, json } from "@/lib/api";
import { env } from "@/lib/env";

/**
 * The daily vendor sync. Vercel Cron calls this with the CRON_SECRET; without
 * the secret the route refuses, so nothing can trigger syncs from outside.
 * Every repository with vendors and a sync older than twenty hours is queued.
 */
export const GET = handler(async (request) => {
  const secret = env("CRON_SECRET");
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) throw new ApiError(401, "unauthorized", "Unauthorized");
  const due = await reposDueForSync(20, 200);
  let queued = 0;
  for (const repo of due) {
    if (await jobActive("vendor_sync", "repoId", repo.id)) continue;
    await enqueueJob("vendor_sync", { repoId: repo.id, ownerUserId: repo.owner_user_id, hints: null }, { maxAttempts: 1 });
    queued += 1;
  }
  return json({ ok: true, due: due.length, queued });
});
