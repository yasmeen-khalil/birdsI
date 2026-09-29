import { z } from "zod";
import { markSnapshotUploaded } from "@birdsi/db";
import { handler, json, parseBody, requireCaller } from "@/lib/api";

const Body = z.object({ bytes: z.number().int().nonnegative().nullable().optional() });

export const POST = handler(async (request, { params }) => {
  const user = await requireCaller(request);
  const { snapshotId } = await params;
  const body = await parseBody(request, Body);
  await markSnapshotUploaded(snapshotId!, user.id, body.bytes ?? null);
  return json({ ok: true });
});
