import { addRecordEntry, type RecordInput, type UserRow } from "@birdsi/db";
import { RECORD_AUTHOR_LABEL, type RecordAuthorKind } from "@birdsi/shared";

export interface RecordAuthor {
  kind: RecordAuthorKind;
  label: string | null;
}

/** The person, by their GitHub login. */
export function ownerAuthor(user: UserRow): RecordAuthor {
  return { kind: "owner", label: user.github_login };
}

/** Who is writing: an agent through MCP, or the person (browser or terminal). */
export function callerAuthor(request: Request, user: UserRow): RecordAuthor {
  return request.headers.get("x-birdsi-client") === "mcp" ? { kind: "agent", label: RECORD_AUTHOR_LABEL.agent } : ownerAuthor(user);
}

/**
 * Appends to the record without ever blocking the action it describes: before
 * the record migration nothing is written; a database error is logged.
 */
export async function note(repoId: string | null, author: RecordAuthor, input: Omit<RecordInput, "authorKind" | "authorLabel">): Promise<void> {
  if (!repoId) return;
  try {
    await addRecordEntry(repoId, { ...input, authorKind: author.kind, authorLabel: author.label });
  } catch (error) {
    console.error(`[record] ${input.kind} not written: ${error instanceof Error ? error.message : String(error)}`);
  }
}
