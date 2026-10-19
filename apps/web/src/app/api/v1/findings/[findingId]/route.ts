import { handler, json, requireCaller } from "@/lib/api";
import { loadFinding } from "@/lib/scans";

export const GET = handler(async (request, { params }) => {
  const user = await requireCaller(request);
  const { findingId } = await params;
  return json(await loadFinding(findingId!, user));
});
