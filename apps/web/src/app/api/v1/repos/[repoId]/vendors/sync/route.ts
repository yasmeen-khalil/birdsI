import { ApiError, handler, json, requireCaller } from "@/lib/api";
import { startVendorSync } from "@/lib/ops";

/** Runs the ops stage alone: connectors, pricing pages, questions. */
export const POST = handler(async (request, { params }) => {
  const user = await requireCaller(request);
  const { repoId } = await params;
  const result = await startVendorSync(repoId!, user);
  if (!result.queued) throw new ApiError(409, "not_queued", result.reason ?? "The sync could not start.");
  return json({ ok: true });
});
