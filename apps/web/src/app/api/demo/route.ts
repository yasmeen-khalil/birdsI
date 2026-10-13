import { clientKey, handler, json } from "@/lib/api";
import { demoOwnerCookie } from "@/lib/demo-owner";
import { startDemoScan } from "@/lib/scans";

/** Starts a scan of the sample repository for a visitor. No sign-in needed. */
export const POST = handler(async (request) => {
  const result = await startDemoScan(clientKey(request));
  const response = json(result, { status: result.reused ? 200 : 201 });
  // Only a scan this visitor started may be stopped by them.
  const cookie = result.reused ? null : demoOwnerCookie(result.scanId);
  if (cookie) response.cookies.set(cookie.name, cookie.value, cookie.options);
  return response;
});
