import { handler, json, requireCaller } from "@/lib/api";
import { stopScan } from "@/lib/scans";

export const POST = handler(async (request, { params }) => {
  const user = await requireCaller(request);
  const { scanId } = await params;
  await stopScan(scanId!, user);
  return json({ ok: true });
});
