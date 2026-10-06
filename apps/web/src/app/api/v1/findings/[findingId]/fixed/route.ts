import { MarkFixedRequest } from "@birdsi/shared";
import { handler, json, parseBody, requireCaller } from "@/lib/api";
import { callerAuthor } from "@/lib/record";
import { markFindingFixed } from "@/lib/scans";

/** The writer says the finding is fixed in the code; the next scan is the judge. */
export const POST = handler(async (request, { params }) => {
  const user = await requireCaller(request);
  const { findingId } = await params;
  const body = await parseBody(request, MarkFixedRequest);
  await markFindingFixed(findingId!, user, body.note?.trim() || null, callerAuthor(request, user));
  return json({ ok: true });
});
