import { findingForViewer, fixById, NotFoundError, toFix } from "@birdsi/db";
import { handler, json, optionalCaller } from "@/lib/api";

export const GET = handler(async (request, { params }) => {
  const user = await optionalCaller(request);
  const { fixId } = await params;
  const fix = await fixById(fixId!);
  if (!fix) throw new NotFoundError("fix");
  await findingForViewer(fix.finding_id, user?.id ?? null);
  return json({ fix: toFix(fix) }, { headers: { "cache-control": "no-store" } });
});
