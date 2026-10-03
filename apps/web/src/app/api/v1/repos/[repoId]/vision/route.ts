import { SetVisionRequest, type VisionResponse } from "@birdsi/shared";
import { handler, json, parseBody, requireCaller } from "@/lib/api";
import { loadVision, saveVision } from "@/lib/ops";

export const GET = handler(async (request, { params }) => {
  const user = await requireCaller(request);
  const { repoId } = await params;
  return json({ vision: await loadVision(repoId!, user) } satisfies VisionResponse);
});

export const PUT = handler(async (request, { params }) => {
  const user = await requireCaller(request);
  const { repoId } = await params;
  const body = await parseBody(request, SetVisionRequest);
  return json({ vision: await saveVision(repoId!, user, body.text) } satisfies VisionResponse);
});
