import type { InventoryResponse } from "@birdsi/shared";
import { handler, json, requireCaller } from "@/lib/api";
import { loadInventory } from "@/lib/ops";

/** Everything an agent needs about a repository in one call. */
export const GET = handler(async (request, { params }) => {
  const user = await requireCaller(request);
  const { repoId } = await params;
  return json((await loadInventory(repoId!, user)) satisfies InventoryResponse);
});
