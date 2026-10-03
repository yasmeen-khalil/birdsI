import { AskOwnerRequest, QuestionStatus, type QuestionsResponse } from "@birdsi/shared";
import { handler, json, parseBody, requireCaller } from "@/lib/api";
import { askOwner, loadQuestions } from "@/lib/ops";

export const GET = handler(async (request, { params }) => {
  const user = await requireCaller(request);
  const { repoId } = await params;
  const raw = new URL(request.url).searchParams.get("status");
  const status = raw ? QuestionStatus.parse(raw) : undefined;
  return json({ questions: await loadQuestions(repoId!, user, status) } satisfies QuestionsResponse);
});

/** An agent asks the owner a question. */
export const POST = handler(async (request, { params }) => {
  const user = await requireCaller(request);
  const { repoId } = await params;
  const body = await parseBody(request, AskOwnerRequest);
  return json({ question: await askOwner(repoId!, user, body) }, { status: 201 });
});
