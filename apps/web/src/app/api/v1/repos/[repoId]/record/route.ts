import { RecordKind, WriteRecordRequest, type RecordResponse } from "@birdsi/shared";
import { handler, json, parseBody, requireCaller } from "@/lib/api";
import { loadRecord, writeRecord } from "@/lib/ops";
import { callerAuthor } from "@/lib/record";

/** The record, newest first. `kind` filters; `limit` up to 200. */
export const GET = handler(async (request, { params }) => {
  const user = await requireCaller(request);
  const { repoId } = await params;
  const url = new URL(request.url);
  const rawKind = url.searchParams.get("kind");
  const kind = rawKind ? RecordKind.parse(rawKind) : undefined;
  // Anything outside 1 to 200, or not a number, falls back to the nearest allowed value.
  const asked = Number.parseInt(url.searchParams.get("limit") ?? "50", 10);
  const limit = Number.isFinite(asked) ? Math.min(200, Math.max(1, asked)) : 50;
  return json({ entries: await loadRecord(repoId!, user, { ...(kind ? { kind } : {}), limit }) } satisfies RecordResponse);
});

/** A decision, or a fact about a vendor, in the writer's own name. */
export const POST = handler(async (request, { params }) => {
  const user = await requireCaller(request);
  const { repoId } = await params;
  const body = await parseBody(request, WriteRecordRequest);
  return json({ entry: await writeRecord(repoId!, user, body, callerAuthor(request, user)) }, { status: 201 });
});
