import { z } from "zod";
import type { VercelDeployment, VercelLogLine, VercelRead } from "@birdsi/shared";
import type { ModelClient } from "../models/client";
import { toJsonSchema } from "../models/schema";

/**
 * A failed deployment explained in plain words by the small model, from the
 * error lines the hosting provider kept. It reads the provider's log, never
 * the code, and what it says is Judgment, shown as the model's.
 */

const Explanation = z.object({
  whatBroke: z.string().max(400).describe("What went wrong, in one or two plain sentences, from the lines only"),
  whatToDo: z.string().max(400).describe("What to look at or change, in one or two plain sentences"),
});
const EXPLANATION_JSON_SCHEMA = toJsonSchema(Explanation);

export const EXPLAIN_SYSTEM = `You explain to a builder who does not read logs why a deployment failed, from the error lines the hosting provider kept. Say what broke in one or two short sentences, then what to look at or change in one or two more. Plain words, no jargon without a gloss, nothing invented: when the lines do not say, say what to look at. Do not use emojis, em dashes, semicolons or exclamation marks.`;

export interface Failure {
  deployment: VercelDeployment;
  lines: VercelLogLine[];
}

/** The newest production deployment when it failed and left something to read, or null. */
export function failedProduction(read: VercelRead): Failure | null {
  if (!read.deployments.ok) return null;
  const production = read.deployments.value.filter((d) => d.target === "production").sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const newest = production[0];
  if (!newest || newest.state !== "ERROR") return null;
  const lines = read.errors.ok ? read.errors.value.filter((l) => l.deploymentId === newest.id) : [];
  if (lines.length === 0 && !newest.errorMessage) return null;
  return { deployment: newest, lines };
}

export async function explainFailure(models: ModelClient, input: { project: string } & Failure): Promise<{ text: string; model: string }> {
  const { deployment, lines } = input;
  const user = [
    `Vercel project: ${input.project}.`,
    `Deployment: ${deployment.createdAt}${deployment.commitSha ? `, commit ${deployment.commitSha.slice(0, 7)}` : ""}${deployment.commitMessage ? ` (${deployment.commitMessage})` : ""}${deployment.branch ? `, branch ${deployment.branch}` : ""}.`,
    deployment.errorMessage ? `Vercel says: ${deployment.errorMessage}` : "Vercel gives no error message.",
    lines.length > 0 ? `Error lines (${lines.length}, ${lines.some((l) => l.from === "build") ? "from the build" : "from the running functions"}):\n${lines.map((l) => `- [${l.from}] ${l.text}`).join("\n")}` : "No error lines were kept.",
  ].join("\n");
  const answer = await models.complete({ tier: "nano", purpose: "explain", system: EXPLAIN_SYSTEM, user, schema: Explanation, jsonSchema: EXPLANATION_JSON_SCHEMA, schemaName: "explanation", maxOutputTokens: 600 });
  return { text: `${answer.whatBroke.trim()} ${answer.whatToDo.trim()}`.trim(), model: models.modelId("nano") };
}
