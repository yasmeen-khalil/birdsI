import { latestRecordBySubject, recordAvailable, repoForUser, type UserRow } from "@birdsi/db";
import { PromptSection, SavePromptRequest, type AppPrompt } from "@birdsi/shared";
import { ApiError } from "./api";
import { note, ownerAuthor } from "./record";

/**
 * The owner's additions to each section's prompt, kept in the record as
 * entries of kind prompt, the newest per section winning. The engine gets
 * them before every map, so a change applies to the next map.
 */
export async function loadPrompts(repoId: string, user: UserRow): Promise<AppPrompt[]> {
  const repo = await repoForUser(repoId, user.id);
  const latest = await latestRecordBySubject(repo.id, "prompt");
  return PromptSection.options.map((section) => {
    const row = latest.get(section);
    return { section, text: row?.text ?? "", updatedAt: row?.created_at ?? null };
  });
}

export async function savePrompt(repoId: string, user: UserRow, input: unknown): Promise<AppPrompt> {
  const parsed = SavePromptRequest.safeParse(input);
  if (!parsed.success) throw new ApiError(400, "bad_request", "Keep the addition under 4,000 characters.");
  const repo = await repoForUser(repoId, user.id);
  if (!(await recordAvailable())) throw new ApiError(503, "not_ready", "Prompts switch on when the record migration 20261006000100_record.sql has run.");
  const text = parsed.data.text.trim();
  await note(repo.id, ownerAuthor(user), { kind: "prompt", subject: parsed.data.section, text, why: null });
  return { section: parsed.data.section, text, updatedAt: new Date().toISOString() };
}
