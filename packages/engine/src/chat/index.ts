import { z } from "zod";
import type { Finding } from "@birdsi/shared";
import { REVIEW_VOICE } from "../checks/model-findings";
import type { EngineConfig } from "../config";
import { ModelClient, type UsageSink } from "../models/client";
import { toJsonSchema } from "../models/schema";

/**
 * Chat over a scanned repository. Retrieval is embedding-based when chunks
 * are available and keyword-based otherwise; the answer cites files and
 * findings, and says when it rests on judgment alone.
 */
export interface Chunk {
  path: string;
  lineStart: number;
  lineEnd: number;
  text: string;
  embedding?: number[];
}

const ChatOutput = z.object({
  answer: z.string().max(3000),
  citations: z.array(z.object({ path: z.string().nullable(), lineStart: z.number().int().nullable(), findingId: z.string().nullable(), label: z.string().max(120) })).max(8),
  judgment: z.boolean().describe("true when the answer rests on your reading and no finding or file line proves it"),
});
const CHAT_JSON_SCHEMA = toJsonSchema(ChatOutput);

const SYSTEM = `You are birdsI, answering questions about one codebase for its owner. ${REVIEW_VOICE}

Use only the excerpts and findings provided. Cite the file and line, or the finding, for every claim you can. If the answer is not in what you were given, say what you would need to look at. Set judgment to true whenever part of the answer is your reading rather than something a finding or an excerpt shows directly.`;

export async function chunkFile(path: string, content: string, maxChars = 1800): Promise<Chunk[]> {
  const lines = content.split("\n");
  const chunks: Chunk[] = [];
  let start = 0;
  while (start < lines.length) {
    let end = start;
    let size = 0;
    while (end < lines.length && size + lines[end]!.length + 1 <= maxChars) {
      size += lines[end]!.length + 1;
      end++;
    }
    if (end === start) end = start + 1;
    chunks.push({ path, lineStart: start + 1, lineEnd: end, text: lines.slice(start, end).join("\n") });
    start = Math.max(end - 3, start + 1);
    if (end >= lines.length) break;
  }
  return chunks;
}

export async function embedChunks(config: EngineConfig, chunks: Chunk[], onUsage?: UsageSink): Promise<Chunk[]> {
  const models = new ModelClient(config, onUsage ? { onUsage } : {});
  const out: Chunk[] = [];
  for (let i = 0; i < chunks.length; i += 32) {
    const batch = chunks.slice(i, i + 32);
    const vectors = await models.embed(batch.map((c) => `${c.path}\n${c.text}`), "embed");
    batch.forEach((c, j) => out.push({ ...c, embedding: vectors[j]! }));
  }
  return out;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function keywordScore(query: string, chunk: Chunk): number {
  const words = query.toLowerCase().split(/[^a-z0-9_]+/).filter((w) => w.length > 2);
  const hay = `${chunk.path} ${chunk.text}`.toLowerCase();
  let score = 0;
  for (const w of words) if (hay.includes(w)) score += 1 + (chunk.path.toLowerCase().includes(w) ? 2 : 0);
  return score;
}

export async function answerQuestion(
  config: EngineConfig,
  input: {
    question: string;
    history: Array<{ role: "user" | "assistant"; content: string }>;
    /** Retrieval: either pre-ranked chunks (from the database) or all chunks to rank here. */
    chunks: Chunk[];
    findings: Finding[];
    repoName: string;
    onUsage?: UsageSink;
  },
): Promise<z.infer<typeof ChatOutput>> {
  const models = new ModelClient(config, input.onUsage ? { onUsage: input.onUsage } : {});
  let ranked = input.chunks;
  if (ranked.length > 12) {
    const withVectors = ranked.filter((c) => c.embedding);
    if (withVectors.length === ranked.length) {
      const [q] = await models.embed([input.question], "embed");
      ranked = ranked.map((c) => ({ c, s: cosine(q!, c.embedding!) })).sort((a, b) => b.s - a.s).slice(0, 12).map((x) => x.c);
    } else {
      ranked = ranked.map((c) => ({ c, s: keywordScore(input.question, c) })).sort((a, b) => b.s - a.s).slice(0, 12).map((x) => x.c);
    }
  }
  const relevantFindings = input.findings
    .map((f) => ({ f, s: keywordScore(input.question, { path: f.location?.path ?? "", lineStart: 0, lineEnd: 0, text: `${f.title} ${f.explanation}` }) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 8)
    .map((x) => x.f);
  const context = [
    `Repository: ${input.repoName}`,
    `Findings:\n${relevantFindings.map((f) => `- id ${f.id} [${f.severity}/${f.confidence}] ${f.title}${f.location ? ` (${f.location.path}${f.location.lineStart ? `:${f.location.lineStart}` : ""})` : ""}: ${f.explanation.slice(0, 240)}`).join("\n") || "none relevant"}`,
    `Code excerpts:\n${ranked.map((c) => `${c.path}:${c.lineStart}-${c.lineEnd}\n${c.text}`).join("\n\n") || "none"}`,
  ].join("\n\n");
  return models.complete({
    tier: "nano",
    fast: true,
    purpose: "chat",
    system: SYSTEM,
    user: `${context}\n\nConversation so far:\n${input.history.slice(-6).map((m) => `${m.role}: ${m.content}`).join("\n")}\n\nQuestion: ${input.question}`,
    schema: ChatOutput,
    jsonSchema: CHAT_JSON_SCHEMA,
    schemaName: "chat",
    maxOutputTokens: 1500,
    temperature: 0.2,
  });
}
