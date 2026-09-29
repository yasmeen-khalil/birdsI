import { reposForUser, toRepo } from "@birdsi/db";
import type { ReposResponse } from "@birdsi/shared";
import { handler, json, requireCaller } from "@/lib/api";

export const GET = handler(async (request) => {
  const user = await requireCaller(request);
  const repos = await reposForUser(user.id);
  return json({ repos: repos.map(toRepo) } satisfies ReposResponse);
});
