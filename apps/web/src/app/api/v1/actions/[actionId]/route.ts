import { handler, json, requireCaller } from "@/lib/api";
import { loadActionForUser } from "@/lib/ops";

export const GET = handler(async (request, { params }) => {
  const user = await requireCaller(request);
  const { actionId } = await params;
  return json({ action: await loadActionForUser(actionId!, user) });
});
