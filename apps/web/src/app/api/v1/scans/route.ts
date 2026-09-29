import { CreateScanRequest, type CreateScanResponse } from "@birdsi/shared";
import { handler, json, parseBody, requireCaller } from "@/lib/api";
import { startScan } from "@/lib/scans";

export const POST = handler(async (request) => {
  const user = await requireCaller(request);
  const body = await parseBody(request, CreateScanRequest);
  const source = request.headers.get("x-birdsi-client") === "mcp" ? "mcp" : request.headers.get("authorization") ? "cli" : "web";
  const scan = await startScan(user, body, source);
  return json({ scan } satisfies CreateScanResponse, { status: 201 });
});
