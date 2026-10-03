import { handler, json, requireCaller } from "@/lib/api";
import { loadVendors } from "@/lib/ops";

export const GET = handler(async (request, { params }) => {
  const user = await requireCaller(request);
  const { repoId } = await params;
  return json(await loadVendors(repoId!, user));
});
