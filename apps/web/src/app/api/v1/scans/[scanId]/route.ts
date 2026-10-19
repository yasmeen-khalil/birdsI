import { handler, json, requireCaller } from "@/lib/api";
import { loadScan } from "@/lib/scans";

export const GET = handler(async (request, { params }) => {
  const user = await requireCaller(request);
  const { scanId } = await params;
  return json(await loadScan(scanId!, user));
});
