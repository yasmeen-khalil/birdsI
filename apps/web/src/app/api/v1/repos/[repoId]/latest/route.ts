import { ApiError, handler, json, requireCaller } from "@/lib/api";
import { loadLatestScan } from "@/lib/scans";

export const GET = handler(async (request, { params }) => {
  const user = await requireCaller(request);
  const { repoId } = await params;
  const result = await loadLatestScan(repoId!, user);
  if (!result) throw new ApiError(404, "no_scan", "This repository has not been scanned yet.");
  return json(result);
});
