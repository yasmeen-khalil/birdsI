import { handler, json, requireCaller } from "@/lib/api";
import { dismissFinding } from "@/lib/scans";

export const POST = handler(async (request, { params }) => {
  const user = await requireCaller(request);
  const { findingId } = await params;
  await dismissFinding(findingId!, user);
  return json({ ok: true });
});
