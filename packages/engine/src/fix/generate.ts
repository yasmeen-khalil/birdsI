import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { Finding } from "@birdsi/shared";
import type { EngineConfig } from "../config";
import { ModelClient, type BeforeCall, type UsageSink } from "../models/client";
import { toJsonSchema } from "../models/schema";
import { numberLines } from "../scan/digest";
import type { Snapshot } from "../source/types";
import { applyEdits, FileEdit, toUnifiedDiff, type AppliedFile } from "./edits";
import { resolveInsideRoot } from "./paths";
import { REVIEW_VOICE } from "../checks/model-findings";

const FixOutput = z.object({
  summary: z.string().max(400).describe("What the change does, for the pull request description, in plain words"),
  edits: z.array(FileEdit).min(1).max(12),
  /** A command that proves the fix, when the repository has one (tests, typecheck, build). */
  verifyCommand: z.string().max(200).nullable(),
  followUp: z.array(z.string().max(200)).max(5).describe("Things the developer still has to do outside the code"),
});
export type FixOutput = z.infer<typeof FixOutput>;
const FIX_JSON_SCHEMA = toJsonSchema(FixOutput);

const SYSTEM = `You are birdsI, writing the smallest correct change that resolves one finding. ${REVIEW_VOICE}

Rules for edits:
- Use "replace" edits with a search string copied exactly from the file as shown (without the line-number prefix). The search text must be unique in the file. Include enough surrounding lines to make it unique.
- Use "create" only for new files. Use "delete" only when the finding is about a file that should not exist.
- Keep the change minimal and idiomatic for this codebase. Do not reformat unrelated code. Do not add comments explaining the fix.
- Never write a secret value into the code. Read it from the environment and add the variable name to .env.example if that file exists.
- If the fix needs a new dependency, add it to the manifest with a sensible version and say so in followUp.
- verifyCommand is the project's own test or typecheck command if one exists in package.json scripts or an equivalent; otherwise null.`;

export interface GeneratedFix {
  summary: string;
  files: AppliedFile[];
  patch: string;
  verifyCommand: string | null;
  followUp: string[];
  usage: { inputTokens: number; outputTokens: number; costMicrodollars: number };
}

/**
 * Asks the fix model for edits, applies them in memory against the real
 * snapshot, and returns the resulting files and a patch. Nothing is written
 * to disk or to GitHub here.
 */
export async function generateFix(config: EngineConfig, input: { finding: Finding; snapshot: Snapshot; onUsage?: UsageSink; beforeCall?: BeforeCall }): Promise<GeneratedFix> {
  const usage = { inputTokens: 0, outputTokens: 0, costMicrodollars: 0 };
  const models = new ModelClient(config, {
    ...(input.beforeCall ? { beforeCall: input.beforeCall } : {}),
    onUsage: async (u) => {
      usage.inputTokens += u.inputTokens;
      usage.outputTokens += u.outputTokens;
      usage.costMicrodollars += u.costMicrodollars;
      await input.onUsage?.(u);
    },
  });
  const { finding, snapshot } = input;
  const read = async (path: string): Promise<string | null> => {
    const full = await resolveInsideRoot(snapshot.root, path);
    if (!full) return null;
    try {
      return await readFile(full, "utf8");
    } catch {
      return null;
    }
  };

  const paths = new Set<string>();
  if (finding.location?.path) paths.add(finding.location.path);
  for (const p of finding.fixPlan?.paths ?? []) paths.add(p);
  for (const extra of [".env.example", "package.json"]) if (paths.size < 6 && (await read(extra)) !== null) paths.add(extra);

  const shown: string[] = [];
  for (const path of paths) {
    const content = await read(path);
    if (content === null) {
      shown.push(`File: ${path}\n(does not exist)`);
      continue;
    }
    const clipped = content.length > 60_000 ? content.slice(0, 60_000) : content;
    shown.push(`File: ${path}\n\`\`\`\n${numberLines(clipped)}\n\`\`\``);
  }
  let scripts = "";
  const pkg = await read("package.json");
  if (pkg) {
    try {
      scripts = JSON.stringify((JSON.parse(pkg) as { scripts?: Record<string, string> }).scripts ?? {});
    } catch {
      // ignore
    }
  }

  let lastError: string | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const output = await models.complete({
      tier: "super",
      fast: true,
      purpose: "fix",
      system: SYSTEM,
      user: [
        `Finding: ${finding.title}`,
        `Explanation: ${finding.explanation}`,
        finding.fixPlan ? `Planned change: ${finding.fixPlan.summary}` : "",
        finding.evidence.excerpt ? `Evidence:\n${finding.evidence.excerpt}` : "",
        scripts ? `package.json scripts: ${scripts}` : "",
        lastError ? `Your previous edits could not be applied: ${lastError}. Copy the search text exactly from the file.` : "",
        shown.join("\n\n"),
      ]
        .filter(Boolean)
        .join("\n\n"),
      schema: FixOutput,
      jsonSchema: FIX_JSON_SCHEMA,
      schemaName: "fix",
      maxOutputTokens: 6000,
    });
    try {
      const files = await applyEdits(output.edits, read);
      if (files.length === 0) throw new Error("The edits changed nothing");
      return { summary: output.summary, files, patch: toUnifiedDiff(files), verifyCommand: output.verifyCommand, followUp: output.followUp, usage };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(`birdsI could not produce a change that applies cleanly: ${lastError}`);
}
