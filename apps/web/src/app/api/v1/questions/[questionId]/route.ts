import { z } from "zod";
import { handler, json, parseBody, requireCaller } from "@/lib/api";
import { answerQuestion, dismissQuestion } from "@/lib/ops";

const Body = z.object({ answer: z.string().max(2000).optional(), dismiss: z.boolean().optional() });

/** Answers or dismisses a question. */
export const POST = handler(async (request, { params }) => {
  const user = await requireCaller(request);
  const { questionId } = await params;
  const body = await parseBody(request, Body);
  if (body.dismiss) {
    await dismissQuestion(questionId!, user);
    return json({ ok: true });
  }
  return json({ question: await answerQuestion(questionId!, user, body.answer ?? "") });
});
