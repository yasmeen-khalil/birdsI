import { DecideActionRequest } from "@birdsi/shared";
import { handler, json, parseBody, requireCaller } from "@/lib/api";
import { decideActionRequest } from "@/lib/ops";

export const POST = handler(async (request, { params }) => {
  const user = await requireCaller(request);
  const { actionId } = await params;
  const body = await parseBody(request, DecideActionRequest);
  return json({ action: await decideActionRequest(actionId!, user, body.decision) });
});
