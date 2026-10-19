import type { AlertsResponse } from "@birdsi/shared";
import { handler, json, requireCaller } from "@/lib/api";
import { loadAlerts } from "@/lib/cockpit";

/** The app's alert stream: open alerts and those closed in the last two weeks, newest first, with the dates to watch and whether alerts are emailed. */
export const GET = handler(async (request, { params }) => {
  const user = await requireCaller(request);
  const { repoId } = await params;
  return json((await loadAlerts(repoId!, user)) satisfies AlertsResponse);
});
