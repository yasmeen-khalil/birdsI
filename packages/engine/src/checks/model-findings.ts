import { z } from "zod";
import { findingKey, type Confidence, type FindingDraft } from "@birdsi/shared";
import { toJsonSchema } from "../models/schema";
import { maskSecrets } from "./secrets";

/**
 * The shape the model fills in when it reports a problem. Kept smaller than
 * the finding record so the model's job is judgment, not bookkeeping.
 */
export const ModelFinding = z.object({
  title: z.string().max(140).describe("One plain sentence naming the problem, for a non-technical reader"),
  explanation: z.string().max(900).describe("What is wrong, where, and how you know. Plain words."),
  whyItMatters: z.string().max(500).describe("The concrete consequence if it is left as is"),
  severity: z.enum(["critical", "high", "medium", "low"]),
  category: z.enum(["security", "gap", "inconsistency", "contradiction", "docs", "config", "dependency"]),
  path: z.string().nullable().describe("Repository-relative file path the problem lives in, or null"),
  lineStart: z.number().int().positive().nullable(),
  lineEnd: z.number().int().positive().nullable(),
  excerpt: z.string().max(600).nullable().describe("The exact lines that show the problem, copied verbatim"),
  certainty: z.number().min(0).max(1).describe("How sure you are that this is a real problem, not a style preference"),
  actionKind: z.enum(["fix", "steps"]).describe("fix when a code change alone resolves it, steps when the developer must act outside the code"),
  steps: z.array(z.object({ title: z.string().max(120), detail: z.string().max(400).nullable(), snippet: z.string().max(600).nullable() })).max(6),
  fixSummary: z.string().max(300).nullable().describe("For fix: what the change is, in one or two sentences"),
  fixPaths: z.array(z.string()).max(8).describe("For fix: files the change touches"),
  /** For doc-backed findings only. */
  docUrl: z.string().nullable().describe("The URL of the document this rests on, only if one was provided to you"),
  docQuote: z.string().max(400).nullable().describe("The exact passage from that document that supports the finding"),
});
export type ModelFinding = z.infer<typeof ModelFinding>;

export const ModelFindings = z.object({ findings: z.array(ModelFinding).max(25) });
export const MODEL_FINDINGS_JSON_SCHEMA = toJsonSchema(ModelFindings);

export function toDraft(
  checkId: string,
  f: ModelFinding,
  options: { confidence: Confidence; allowedDocs?: Map<string, { title: string; publishedAt?: string }> },
): FindingDraft {
  let confidence = options.confidence;
  let doc: FindingDraft["evidence"]["doc"];
  if (f.docUrl && f.docQuote && options.allowedDocs?.has(f.docUrl)) {
    const meta = options.allowedDocs.get(f.docUrl)!;
    doc = { url: f.docUrl, title: meta.title, excerpt: f.docQuote, ...(meta.publishedAt ? { publishedAt: meta.publishedAt } : {}) };
    confidence = "doc_verified";
  } else if (options.confidence === "doc_verified") {
    // The model claimed a doc but did not cite one it was given: downgrade honestly.
    confidence = "judgment";
  }
  const location = f.path
    ? { path: f.path, ...(f.lineStart ? { lineStart: f.lineStart } : {}), ...(f.lineEnd ?? f.lineStart ? { lineEnd: f.lineEnd ?? f.lineStart! } : {}) }
    : null;
  return {
    key: findingKey({ checkId, path: f.path, subject: f.title }),
    checkId,
    title: f.title.trim(),
    explanation: f.explanation.trim(),
    whyItMatters: f.whyItMatters.trim(),
    severity: f.severity,
    confidence,
    category: f.category,
    location,
    evidence: {
      // Copied verbatim from the code by the model, so key shapes are masked before it is stored.
      ...(f.excerpt ? { excerpt: maskSecrets(f.excerpt) } : {}),
      ...(doc ? { doc } : {}),
      advisories: [],
    },
    actionKind: f.actionKind,
    steps: f.steps.map((s) => ({ title: s.title, ...(s.detail ? { detail: s.detail } : {}), ...(s.snippet ? { snippet: maskSecrets(s.snippet) } : {}) })),
    fixPlan: f.actionKind === "fix" ? { summary: f.fixSummary ?? f.title, paths: f.fixPaths.length > 0 ? f.fixPaths : f.path ? [f.path] : [], followUp: [] } : null,
  };
}

export const REVIEW_VOICE = `You write for a builder who ships real apps but does not read code fluently. Plain words, short sentences, no jargon without a gloss. Say what was found, why it matters, what happens next. Never alarmist. Prefer "fix" over "remediate" and "problem" over "vulnerability" unless it is a published vulnerability. Do not use emojis, em dashes, semicolons or exclamation marks. Use commas, colons or periods.`;

/** Drops low-certainty and malformed model findings before they become records. */
export function filterModelFindings(findings: ModelFinding[], minCertainty: number, knownPaths: Set<string>): ModelFinding[] {
  return findings.filter((f) => {
    if (f.certainty < minCertainty) return false;
    if (f.path && !knownPaths.has(f.path)) {
      // A path that does not exist means the model invented a location; keep the finding only if it is not tied to a file.
      f.path = null;
      f.lineStart = null;
      f.lineEnd = null;
    }
    // Fix paths are later read from disk, so only files that exist in the snapshot are kept.
    f.fixPaths = f.fixPaths.filter((p) => knownPaths.has(p));
    return f.title.trim().length > 0;
  });
}

export function isBudget(error: unknown): boolean {
  return error instanceof Error && error.name === "BudgetExceededError";
}

export function isOutputLimit(error: unknown): boolean {
  return error instanceof Error && error.name === "OutputLimitError";
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200);
}
