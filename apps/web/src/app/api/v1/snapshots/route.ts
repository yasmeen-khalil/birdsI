import { z } from "zod";
import { createSnapshotUpload } from "@birdsi/db";
import { MAX_SNAPSHOT_BYTES } from "@birdsi/engine";
import type { SnapshotUploadResponse } from "@birdsi/shared";
import { handler, json, parseBody, requireCaller } from "@/lib/api";

const Body = z.object({
  fullName: z.string().max(200).optional(),
  branch: z.string().max(200).optional(),
  commitSha: z.string().max(64).optional(),
});

/** Registers a CLI upload and returns a signed URL for the tarball. */
export const POST = handler(async (request) => {
  const user = await requireCaller(request);
  const body = await parseBody(request, Body);
  const { row, uploadUrl } = await createSnapshotUpload(user.id, { fullName: body.fullName ?? null, branch: body.branch ?? null, commitSha: body.commitSha ?? null });
  return json({ snapshotId: row.id, uploadUrl, maxBytes: MAX_SNAPSHOT_BYTES } satisfies SnapshotUploadResponse);
});
