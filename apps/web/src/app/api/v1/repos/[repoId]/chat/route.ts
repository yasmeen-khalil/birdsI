import { z } from "zod";
import { handler, json, parseBody, requireCaller } from "@/lib/api";
import { askRepo } from "@/lib/scans";

const Body = z.object({ question: z.string().min(1).max(2000) });

export const POST = handler(async (request, { params }) => {
  const user = await requireCaller(request);
  const { repoId } = await params;
  const { question } = await parseBody(request, Body);
  const message = await askRepo(repoId!, user, question);
  return json({ message });
});
