import type { MapResponse } from "@birdsi/shared";
import { handler, json, requireCaller } from "@/lib/api";
import { loadServiceMap } from "@/lib/cockpit";

/** The app's newest service map, with the file and line of every entry. */
export const GET = handler(async (request, { params }) => {
  const user = await requireCaller(request);
  const { repoId } = await params;
  return json((await loadServiceMap(repoId!, user)) satisfies MapResponse);
});
