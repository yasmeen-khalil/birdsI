import type { CockpitResponse } from "@birdsi/shared";
import { handler, json, requireCaller } from "@/lib/api";
import { loadCockpit } from "@/lib/cockpit";

/** The cockpit of one app: map and live reads in one view, the same one the web page shows. */
export const GET = handler(async (request, { params }) => {
  const user = await requireCaller(request);
  const { repoId } = await params;
  return json({ cockpit: await loadCockpit(repoId!, user) } satisfies CockpitResponse);
});
