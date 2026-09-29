import { handler, json, optionalCaller } from "@/lib/api";
import { loadFinding } from "@/lib/scans";

export const GET = handler(async (request, { params }) => {
  const user = await optionalCaller(request);
  const { findingId } = await params;
  return json(await loadFinding(findingId!, user));
});
