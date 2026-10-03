import { UpdatePolicyRequest } from "@birdsi/shared";
import { handler, json, parseBody, requireCaller } from "@/lib/api";
import { changePolicy } from "@/lib/ops";

export const PATCH = handler(async (request, { params }) => {
  const user = await requireCaller(request);
  const { repoId } = await params;
  const body = await parseBody(request, UpdatePolicyRequest);
  return json({ policy: await changePolicy(repoId!, user, body) });
});
