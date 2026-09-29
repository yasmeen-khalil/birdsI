import { eventsAfter, scanForViewer } from "@birdsi/db";
import type { ScanEventsResponse } from "@birdsi/shared";
import { handler, json, optionalCaller } from "@/lib/api";

/** Progress log for live views. `after` is the last seq the client has seen. */
export const GET = handler(async (request, { params }) => {
  const user = await optionalCaller(request);
  const { scanId } = await params;
  const scan = await scanForViewer(scanId!, user?.id ?? null);
  const url = new URL(request.url);
  const after = Math.max(0, Number.parseInt(url.searchParams.get("after") ?? "0", 10) || 0);
  const events = await eventsAfter(scan.id, after);
  const cursor = events.length > 0 ? events[events.length - 1]!.seq : after;
  return json({ events, cursor, status: scan.status } satisfies ScanEventsResponse, { headers: { "cache-control": "no-store" } });
});
