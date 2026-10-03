import { ReportActionRequest } from "@birdsi/shared";
import { handler, json, parseBody, requireCaller } from "@/lib/api";
import { reportActionResult } from "@/lib/ops";

/** The terminal tool reports the outcome of an approved command it ran. */
export const POST = handler(async (request, { params }) => {
  const user = await requireCaller(request);
  const { actionId } = await params;
  const body = await parseBody(request, ReportActionRequest);
  return json({ action: await reportActionResult(actionId!, user, body.ok, body.output) });
});
