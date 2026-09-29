import { clientKey, handler, json } from "@/lib/api";
import { startDemoScan } from "@/lib/scans";

/** Starts a scan of the sample repository for a visitor. No sign-in needed. */
export const POST = handler(async (request) => {
  const result = await startDemoScan(clientKey(request));
  return json(result, { status: result.reused ? 200 : 201 });
});
