import type { ChangesResponse } from "@birdsi/shared";
import { handler, json, requireCaller } from "@/lib/api";
import { changesSince } from "@/lib/ops";

/** New and resolved findings since a scan (default: the previous finished one). */
export const GET = handler(async (request, { params }) => {
  const user = await requireCaller(request);
  const { repoId } = await params;
  const since = new URL(request.url).searchParams.get("since");
  return json((await changesSince(repoId!, user, since)) satisfies ChangesResponse);
});
