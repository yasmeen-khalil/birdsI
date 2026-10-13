import type { FindingDraft } from "@birdsi/shared";
import { numberLines } from "../scan/digest";
import { filterModelFindings, MODEL_FINDINGS_JSON_SCHEMA, ModelFindings, REVIEW_VOICE, toDraft } from "./model-findings";
import { runPool } from "./pool";
import type { Check, CheckContext } from "./types";

const SYSTEM = `You are birdsI, a careful reviewer reading one file of an application in the context of the whole codebase. ${REVIEW_VOICE}

Look for, in this order of importance:
1. Security holes: missing authorization checks, trusting client-supplied ids, injection (SQL, shell, template), unsafe deserialization, weak crypto, secrets in code, open redirects, missing input validation at a trust boundary, permissive CORS, disabled security features, privileged operations reachable without a check.
2. Gaps: error paths that are not handled, missing states (empty, loading, failure), unfinished work (TODO that blocks correctness), features promised by names or comments but not implemented, money or quota operations that are not atomic.
3. Inconsistencies: two ways of doing the same thing that disagree, a function whose behaviour contradicts its name or comment, types that lie.
4. Contradictions with the rest of the codebase you were told about (routes, env vars, schema).

Rules:
- Report only real problems you can point at with line numbers. Style, naming and formatting are not problems.
- Do not report something that is clearly handled elsewhere (for example, auth enforced by a middleware you were told about).
- certainty is your honest probability that a competent engineer would agree it is a bug or hole.
- actionKind is "fix" only when a change inside the repository resolves it fully. Anything needing a dashboard, a key rotation or a product decision is "steps".
- At most four findings per file, the most important first. Keep explanation under 60 words and whyItMatters under 30. Copy at most six lines into excerpt. Give at most three steps. A short, exact finding beats a long one.
- If the file is fine, return an empty findings list. That is a good outcome, not a failure.`;

export const reviewCheck: Check = {
  id: "review",
  step: "review",
  label: "Reading the code for security holes, gaps and inconsistencies",
  tiers: ["light", "deep", "audit"],
  available: () => true,
  async run(ctx: CheckContext): Promise<FindingDraft[]> {
    const findings: FindingDraft[] = [];
    const knownPaths = new Set(ctx.inventory.files.map((f) => f.path));
    const cachedContext = `Repository overview:\n${ctx.digest.text}\n\n${buildContextNotes(ctx)}`;
    const files = ctx.filesToRead;
    const index: Array<{ path: string; hash: string }> = [];
    let carried = 0;
    let done = 0;
    let stopped = false;
    await ctx.emit({ type: "step_started", step: "review", label: reviewCheck.label, total: files.length });
    const progress = async (): Promise<void> => {
      done += 1;
      await ctx.emit({ type: "step_progress", step: "review", done, total: files.length });
    };
    const reviewFile = async (file: (typeof files)[number]): Promise<void> => {
      if (stopped || ctx.signal.aborted) return;
      try {
        const hash = await ctx.fileHash(file.path);
        index.push({ path: file.path, hash });
        // Unchanged since the last scan: keep what that scan found instead of paying to read it again.
        const previous = ctx.previousReview;
        if (previous && previous.hashes.get(file.path) === hash) {
          for (const draft of previous.findingsByPath.get(file.path) ?? []) {
            findings.push(draft);
            await ctx.emit({ type: "finding", finding: { ...draft, id: draft.key } });
          }
          carried += 1;
          await progress();
          return;
        }
        await ctx.emit({ type: "file_reading", step: "review", path: file.path, checks: ["security holes", "gaps", "inconsistencies"] });
        const content = await ctx.read(file.path);
        const result = await ctx.models.complete({
          tier: ctx.budget.reviewModel,
          fast: ctx.budget.fast,
          purpose: "review",
          system: SYSTEM,
          cachedContext,
          user: `File: ${file.path}\n\`\`\`\n${numberLines(content)}\n\`\`\``,
          schema: ModelFindings,
          jsonSchema: MODEL_FINDINGS_JSON_SCHEMA,
          schemaName: "findings",
          maxOutputTokens: 3000,
          signal: ctx.signal,
        });
        const kept = filterModelFindings(result.findings, 0.55, knownPaths);
        for (const f of kept) {
          if (!f.path) f.path = file.path;
          const draft = toDraft("review", f, { confidence: "judgment" });
          findings.push(draft);
          await ctx.emit({ type: "finding", finding: { ...draft, id: draft.key } });
        }
      } catch (error) {
        if (isBudget(error)) {
          if (!stopped) {
            stopped = true;
            await ctx.note(`Stopped reading files early: the scan budget for this tier was reached after ${done} files.`);
          }
          return;
        }
        await ctx.note(`Could not review ${file.path}: ${errorMessage(error)}`);
      }
      await progress();
    };
    // Several files at once; the budget is checked before every call, so the
    // overshoot is at most the calls in flight when it runs out.
    await runPool(files, ctx.budget.concurrency, reviewFile);
    // Files this tier did not select, or the budget stopped before: when they are
    // unchanged since the last scan, that scan's findings still stand. Without this
    // a quick check after a full scan would lose the full scan's findings, and
    // "what changed" would call them resolved.
    let kept = 0;
    if (ctx.previousReview) {
      const processed = new Set(index.map((f) => f.path));
      for (const [path, previousHash] of ctx.previousReview.hashes) {
        if (ctx.signal.aborted) break;
        if (processed.has(path) || !knownPaths.has(path)) continue;
        let hash: string;
        try {
          hash = await ctx.fileHash(path);
        } catch {
          continue;
        }
        if (hash !== previousHash) continue;
        index.push({ path, hash });
        for (const draft of ctx.previousReview.findingsByPath.get(path) ?? []) {
          findings.push(draft);
          await ctx.emit({ type: "finding", finding: { ...draft, id: draft.key } });
        }
        kept += 1;
      }
    }
    if (carried + kept > 0) {
      await ctx.note(`${carried + kept} files were unchanged since the last scan and kept that scan's findings instead of being read again${kept > 0 ? ` (${kept} of them outside this tier's read list of ${files.length})` : ""}.`);
    }
    await ctx.emit({ type: "review_index", files: index });
    return findings;
  },
};

/** Facts extracted deterministically so the model does not invent them. */
function buildContextNotes(ctx: CheckContext): string {
  const notes: string[] = [];
  const middleware = ctx.inventory.files.filter((f) => /(^|\/)(middleware|proxy)\.[tj]s$/.test(f.path)).map((f) => f.path);
  if (middleware.length > 0) notes.push(`Request middleware exists at: ${middleware.join(", ")}. Auth may be enforced there.`);
  const envExample = ctx.inventory.files.find((f) => /(^|\/)\.env\.example$/.test(f.path));
  if (envExample) notes.push(`Environment variables are documented in ${envExample.path}.`);
  const proven = ctx.findingsSoFar.filter((f) => f.confidence === "proven").slice(0, 15);
  if (proven.length > 0) {
    notes.push(`Already established by deterministic checks (do not repeat these): ${proven.map((f) => `${f.title}${f.location ? ` (${f.location.path})` : ""}`).join(", ")}`);
  }
  return notes.length > 0 ? `Known facts:\n- ${notes.join("\n- ")}` : "";
}

export function isBudget(error: unknown): boolean {
  return error instanceof Error && error.name === "BudgetExceededError";
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200);
}
