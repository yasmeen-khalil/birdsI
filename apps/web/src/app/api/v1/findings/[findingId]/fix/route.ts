import type { StartFixResponse } from "@birdsi/shared";
import { ApiError, handler, json, requireCaller } from "@/lib/api";
import { startFix } from "@/lib/scans";

export const POST = handler(async (request, { params }) => {
  const user = await requireCaller(request);
  const { findingId } = await params;
  const fix = await startFix(findingId!, user);
  if (!fix) throw new ApiError(500, "server_error", "The fix could not be started.");
  return json({ fix } satisfies StartFixResponse, { status: 202 });
});
