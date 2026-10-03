import { z } from "zod";
import { AUDIT_AREAS, MODEL_AUDIT_AREAS, type AuditArea, type AuditAreaResult, type AuditReport, type FindingDraft, type OpsSummary } from "@birdsi/shared";
import { toJsonSchema } from "../models/schema";
import { REVIEW_VOICE } from "./model-findings";
import { errorMessage } from "./review";
import type { CheckContext } from "./types";

const AREA_LABELS: Record<AuditArea, { title: string; question: string }> = {
  auth: { title: "Sign-in and permissions", question: "Can only the right people reach each screen, route and record? Is every gate enforced on the server, not only hidden in the UI?" },
  secrets: { title: "Keys and secrets", question: "Are all keys out of the code and history, read from the environment, and scoped to what they need?" },
  data: { title: "User data", question: "Is user data protected by access rules, backed up by the platform, never lost by a deploy, and deletable when a user asks?" },
  dependencies: { title: "Packages", question: "Are known vulnerabilities fixed and are the main packages on supported versions?" },
  errors: { title: "Failure handling", question: "When a payment, upload, email or external call fails, does the app recover and tell the user, or fail silently or crash?" },
  config: { title: "Deployment settings", question: "Are production settings safe: debug off, CORS scoped, security headers, rate limits on public endpoints, env separation?" },
  legal: { title: "Legal pages", question: "Does the app have a privacy policy and terms, and does what they say match what the code does with data?" },
  tests: { title: "Tests and checks", question: "Is there any automated test or type check that would catch a broken deploy?" },
  operations: { title: "Services and limits", question: "Are the services the app runs on known, on plans that will not pause or run out, and is anything near a limit?" },
};

const AreaVerdict = z.object({
  area: z.enum(MODEL_AUDIT_AREAS as [AuditArea, ...AuditArea[]]),
  verdict: z.enum(["pass", "attention", "blocker"]),
  note: z.string().max(400).describe("Two sentences at most: what was seen and what it means for launch"),
});
const AuditOutput = z.object({
  headline: z.string().max(160).describe("One sentence verdict a founder can act on"),
  areas: z.array(AreaVerdict).length(MODEL_AUDIT_AREAS.length),
  blockers: z.array(z.string().max(160)).max(8).describe("Things that must be fixed before launch, each one line"),
  fixBeforeLaunch: z.array(z.string().max(160)).max(10).describe("Strongly advised before launch"),
  canWait: z.array(z.string().max(160)).max(10).describe("Fine to do after launch"),
});
const AUDIT_JSON_SCHEMA = toJsonSchema(AuditOutput);

const SYSTEM = `You are birdsI, giving a founder a pre-launch verdict on their application. ${REVIEW_VOICE}

You have the repository overview, every finding from a deep scan (with confidence classes), and deterministic facts about tests and legal pages. For each of eight areas, decide: pass (nothing found that affects launch), attention (should be handled soon), blocker (do not launch until fixed). A blocker is a real exposure: leaked keys, unprotected user data, a critical vulnerability with a fix available, payments that can be bypassed. Be decisive and specific. Do not invent problems the findings do not show; if an area has no relevant findings and the facts look fine, it passes.`;

/**
 * The pre-launch audit: eight areas, a verdict each, and three lists. It
 * reads the findings the other checks produced plus a few deterministic
 * facts, and asks the strongest model to judge.
 */
export async function runAudit(ctx: CheckContext, findings: FindingDraft[]): Promise<AuditReport> {
  const facts = await auditFacts(ctx);
  const operations = operationsArea(ctx.ops);
  const findingsText = findings
    .slice(0, 80)
    .map((f) => `- [${f.severity}/${f.confidence}/${f.category}] ${f.title}${f.location ? ` (${f.location.path})` : ""}: ${f.explanation.slice(0, 200)}`)
    .join("\n");
  const areasText = MODEL_AUDIT_AREAS.map((a) => `${a}: ${AREA_LABELS[a].title}. ${AREA_LABELS[a].question}`).join("\n");
  const tier = ctx.budget.crosscheckModel ?? ctx.budget.reviewModel;
  try {
    const output = await ctx.models.complete({
      tier,
      fast: false,
      purpose: "audit",
      system: SYSTEM,
      user: `Areas:\n${areasText}\n\nRepository overview:\n${ctx.digest.text}\n\nDeterministic facts:\n${facts}\n\nFindings (${findings.length}):\n${findingsText || "none"}`,
      schema: AuditOutput,
      jsonSchema: AUDIT_JSON_SCHEMA,
      schemaName: "audit",
      maxOutputTokens: 3000,
      signal: ctx.signal,
    });
    const areas: AuditAreaResult[] = MODEL_AUDIT_AREAS.map((area) => {
      const v = output.areas.find((a) => a.area === area) ?? { area, verdict: "attention" as const, note: "Not assessed." };
      const relevant = findings.filter((f) => areaOf(f) === area).map((f) => f.key);
      return { area, verdict: v.verdict, note: v.note, findingIds: relevant };
    });
    areas.push(operations);
    for (const a of areas) await ctx.emit({ type: "audit_area", area: a.area, verdict: a.verdict, note: a.note });
    const hasBlocker = areas.some((a) => a.verdict === "blocker");
    return {
      verdict: hasBlocker ? "not_ready" : "ready",
      headline: output.headline,
      areas,
      blockers: [...output.blockers, ...(operations.verdict === "blocker" ? [operations.note.split(". ")[0] ?? operations.note] : [])],
      fixBeforeLaunch: output.fixBeforeLaunch,
      canWait: output.canWait,
    };
  } catch (error) {
    await ctx.note(`The audit verdict could not be produced: ${errorMessage(error)}`);
    const areas: AuditAreaResult[] = MODEL_AUDIT_AREAS.map((area) => {
      const relevant = findings.filter((f) => areaOf(f) === area);
      const worst = relevant.find((f) => f.severity === "critical") ? "blocker" : relevant.length > 0 ? "attention" : "pass";
      return { area, verdict: worst as "pass" | "attention" | "blocker", note: relevant.length > 0 ? `${relevant.length} related finding${relevant.length === 1 ? "" : "s"}.` : "Nothing found.", findingIds: relevant.map((f) => f.key) };
    });
    areas.push(operations);
    const hasBlocker = areas.some((a) => a.verdict === "blocker");
    return {
      verdict: hasBlocker ? "not_ready" : "ready",
      headline: hasBlocker ? "Not ready to launch yet: critical findings need fixing first." : "No blockers found. Review the attention items before launch.",
      areas,
      blockers: findings.filter((f) => f.severity === "critical").map((f) => f.title).slice(0, 8),
      fixBeforeLaunch: findings.filter((f) => f.severity === "high").map((f) => f.title).slice(0, 10),
      canWait: findings.filter((f) => f.severity === "medium" || f.severity === "low").map((f) => f.title).slice(0, 10),
    };
  }
}

/**
 * The operations area is judged by rule, never by the model: a blocker is a
 * paused project or a limit at 95%; attention is a limit at 80% or a plan
 * birdsI could not learn; conditions that might happen are named, not held
 * against the launch. With no sync yet, it says so instead of guessing.
 */
export function operationsArea(ops: OpsSummary | null): AuditAreaResult {
  if (!ops || ops.vendors === 0) {
    return { area: "operations", verdict: "pass", note: ops ? "No outside services were found in the code." : "The services the app runs on have not been synced yet; this area is judged after the first sync.", findingIds: [] };
  }
  const critical = ops.alerts.filter((a) => a.level === "critical");
  const warnings = ops.alerts.filter((a) => a.level === "warning");
  const unknownPlans = ops.vendors - ops.plansKnown;
  const watching = ops.watches.length > 0 ? ` Tracking: ${ops.watches.slice(0, 3).map((w) => w.title.toLowerCase()).join("; ")}.` : "";
  if (critical.length > 0) {
    return { area: "operations", verdict: "blocker", note: `${critical.map((a) => a.title).join(". ")}. Launching now means users hit this.${watching}`, findingIds: [] };
  }
  if (warnings.length > 0 || unknownPlans > 0) {
    const parts = [];
    if (warnings.length > 0) parts.push(warnings.map((a) => a.title).join(". "));
    if (unknownPlans > 0) parts.push(`${unknownPlans} of ${ops.vendors} services have no known plan, so their limits cannot be watched`);
    return { area: "operations", verdict: "attention", note: `${parts.join(". ")}.${watching}`, findingIds: [] };
  }
  return { area: "operations", verdict: "pass", note: `${ops.vendors} services known, ${ops.plansKnown} with plans, ${ops.connected} connected. Nothing is near a limit.${watching}`, findingIds: [] };
}

/** Maps a finding to the audit area it informs. */
export function areaOf(f: FindingDraft): AuditArea {
  if (f.checkId === "secrets") return "secrets";
  if (f.checkId === "vulnerabilities" || f.checkId === "freshness" || f.category === "dependency" || f.category === "docs") return "dependencies";
  if (f.checkId === "config" || f.category === "config") return "config";
  const text = `${f.title} ${f.explanation}`.toLowerCase();
  if (/(auth|permission|session|login|sign-in|role|unauthori|owner)/.test(text)) return "auth";
  if (/(privacy|terms|gdpr|consent|legal|cookie)/.test(text)) return "legal";
  if (/(test|typecheck|ci\b)/.test(text)) return "tests";
  if (/(error|fail|crash|retry|timeout|unhandled|catch)/.test(text)) return "errors";
  if (/(data|record|table|database|delete|backup|rls|row level)/.test(text)) return "data";
  return "config";
}

async function auditFacts(ctx: CheckContext): Promise<string> {
  const files = ctx.inventory.files;
  const tests = files.filter((f) => /(^|\/)(__tests__|tests?|spec)\//.test(f.path) || /\.(test|spec)\.[a-z]+$/.test(f.path)).length;
  const ci = files.filter((f) => f.path.startsWith(".github/workflows/")).length;
  const legal = files.filter((f) => /(privacy|terms|legal)/i.test(f.path)).map((f) => f.path).slice(0, 10);
  const pkg = files.find((f) => f.path === "package.json");
  let scripts = "";
  if (pkg) {
    try {
      const json = JSON.parse(await ctx.read("package.json")) as { scripts?: Record<string, string> };
      scripts = Object.keys(json.scripts ?? {}).join(", ");
    } catch {
      // ignore
    }
  }
  return [
    `Test files: ${tests}. CI workflows: ${ci}. package.json scripts: ${scripts || "none"}.`,
    `Files that look like legal pages: ${legal.join(", ") || "none"}.`,
    ctx.appDescription ? `Owner's description of the app: ${ctx.appDescription.slice(0, 500)}` : "The owner gave no description of the app.",
  ].join("\n");
}

export { AREA_LABELS };
