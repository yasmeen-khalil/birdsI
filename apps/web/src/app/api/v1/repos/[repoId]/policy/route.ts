import type { PolicyResponse } from "@birdsi/shared";
import { handler, json, requireCaller } from "@/lib/api";
import { loadPolicy } from "@/lib/ops";

/** The repository's agent policy, for the terminal tool's hook and for agents. */
export const GET = handler(async (request, { params }) => {
  const user = await requireCaller(request);
  const { repoId } = await params;
  return json({ policy: await loadPolicy(repoId!, user) } satisfies PolicyResponse);
});
