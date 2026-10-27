import type { ChecklistResponse } from "@birdsi/shared";
import { handler, json, requireCaller } from "@/lib/api";
import { loadChecklist } from "@/lib/checklist";

/** What birdsI still needs from the owner for this app: the checklist the Set up page shows. */
export const GET = handler(async (request, { params }) => {
  const user = await requireCaller(request);
  const { repoId } = await params;
  return json({ checklist: await loadChecklist(repoId!, user) } satisfies ChecklistResponse);
});
