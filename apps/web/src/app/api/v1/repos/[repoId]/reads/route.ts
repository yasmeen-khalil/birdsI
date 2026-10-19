import type { ReadsResponse } from "@birdsi/shared";
import { handler, json, requireCaller } from "@/lib/api";
import { loadReads } from "@/lib/cockpit";

/** What each Vercel project, Supabase project and OneSignal app said when birdsI last read it, every part dated with its source. */
export const GET = handler(async (request, { params }) => {
  const user = await requireCaller(request);
  const { repoId } = await params;
  return json((await loadReads(repoId!, user)) satisfies ReadsResponse);
});
