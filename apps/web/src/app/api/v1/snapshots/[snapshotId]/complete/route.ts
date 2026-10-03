import { markSnapshotUploaded } from "@birdsi/db";
import { CompleteSnapshotRequest } from "@birdsi/shared";
import { handler, json, parseBody, requireCaller } from "@/lib/api";

/** Marks the upload complete and stores any hints the CLI collected on the owner's machine. */
export const POST = handler(async (request, { params }) => {
  const user = await requireCaller(request);
  const { snapshotId } = await params;
  const body = await parseBody(request, CompleteSnapshotRequest);
  await markSnapshotUploaded(snapshotId!, user.id, body.bytes ?? null, body.hints ?? null);
  return json({ ok: true });
});
