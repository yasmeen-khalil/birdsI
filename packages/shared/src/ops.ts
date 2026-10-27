import { z } from "zod";
import { App } from "./apps";
import { Severity } from "./domain";

/**
 * Everything outside the code that makes an app run: vendors, their plans,
 * limits and usage; the questions only a person can answer; the actions an
 * agent proposes and a person approves; the owner's stated vision.
 */

export const VendorCategory = z.enum([
  "hosting",
  "database",
  "auth",
  "payments",
  "email",
  "ai",
  "search",
  "analytics",
  "storage",
  "messaging",
  "monitoring",
  "maps",
  "media",
  "other",
]);
export type VendorCategory = z.infer<typeof VendorCategory>;

/** Where a fact came from. Each source has a confidence a person can reason about. */
export const FactSource = z.enum(["static", "connector", "docs", "estimate", "asked", "agent"]);
export type FactSource = z.infer<typeof FactSource>;

export const FACT_SOURCE_LABEL: Record<FactSource, string> = {
  static: "Found in the code",
  connector: "Read from the account",
  docs: "From birdsI's checked limits list",
  estimate: "Estimated by birdsI",
  asked: "You told birdsI",
  agent: "Your coding agent told birdsI",
};

/** Which source wins when several state the same metric: the account, then the owner, then an agent, then the docs, the code, an estimate. */
export const FACT_SOURCE_RANK: Record<FactSource, number> = { connector: 0, asked: 1, agent: 2, docs: 3, static: 4, estimate: 5 };

/** One fact per metric, the best-sourced one. */
export function bestFacts<T extends { metric: string; source: FactSource }>(facts: readonly T[]): T[] {
  const best = new Map<string, T>();
  for (const f of facts) {
    const current = best.get(f.metric);
    if (!current || FACT_SOURCE_RANK[f.source] < FACT_SOURCE_RANK[current.source]) best.set(f.metric, f);
  }
  return [...best.values()];
}

export const FactKind = z.enum(["plan", "limit", "usage", "cost", "purpose", "status", "billing"]);
export type FactKind = z.infer<typeof FactKind>;

export const VendorFact = z.object({
  id: z.string(),
  vendorId: z.string(),
  kind: FactKind,
  /** Machine metric name: "plan", "db_size", "monthly_requests", "spend_month". */
  metric: z.string(),
  /** Human label: "Database size", "Requests this month". */
  label: z.string(),
  value: z.string(),
  numeric: z.number().nullable(),
  unit: z.string().nullable(),
  /** For usage facts, the limit it counts against, when known. */
  limitNumeric: z.number().nullable(),
  source: FactSource,
  evidence: z
    .object({
      url: z.string().optional(),
      excerpt: z.string().optional(),
      paths: z.array(z.string()).optional(),
      note: z.string().optional(),
    })
    .default({}),
  observedAt: z.string(),
});
export type VendorFact = z.infer<typeof VendorFact>;

export const CallSite = z.object({
  path: z.string(),
  line: z.number().int().positive(),
  /** The import, URL or env name that revealed it. */
  excerpt: z.string().max(200),
});
export type CallSite = z.infer<typeof CallSite>;

export const Vendor = z.object({
  id: z.string(),
  repoId: z.string(),
  /** Stable slug: "supabase", "vercel", "supadata". */
  slug: z.string(),
  name: z.string(),
  category: VendorCategory,
  /** One sentence, for a reader who has never heard of it. */
  what: z.string(),
  /** What this app uses it for, in plain words. Judgment unless the owner edits it. */
  purpose: z.string().nullable(),
  /** How birdsI knows the app uses it. */
  detectedBy: z.array(z.enum(["package", "env", "url", "config", "projects"])),
  packages: z.array(z.string()),
  envVars: z.array(z.string()),
  callSites: z.array(CallSite),
  pricingUrl: z.string().nullable(),
  docsUrl: z.string().nullable(),
  /** True when birdsI can read the account through a connector. */
  connectable: z.boolean(),
  connected: z.boolean(),
  facts: z.array(VendorFact),
  updatedAt: z.string(),
});
export type Vendor = z.infer<typeof Vendor>;

/** What a check learned before it is stored: the vendor without ids and facts. */
export const VendorDraft = Vendor.omit({ id: true, repoId: true, facts: true, updatedAt: true, connected: true });
export type VendorDraft = z.infer<typeof VendorDraft>;

export const AlertLevel = z.enum(["info", "warning", "critical"]);
export type AlertLevel = z.infer<typeof AlertLevel>;

export const Alert = z.object({
  id: z.string(),
  vendorId: z.string().nullable(),
  vendorName: z.string().nullable(),
  level: AlertLevel,
  title: z.string(),
  detail: z.string(),
  /** A proposed action an agent or the owner can take, when there is one. */
  suggestedCommand: z.string().nullable(),
  /** For limit alerts: when it runs out at the observed rate, when known. */
  runsOutAt: z.string().nullable().default(null),
});
export type Alert = z.infer<typeof Alert>;

/**
 * A condition worth tracking, as opposed to an alert about something true
 * now: a free plan that pauses after inactivity, a trial that ends on a date.
 * Shown as a tracker on the vendor, never as a warning, until evidence shows
 * it is happening.
 */
export const Watch = z.object({
  id: z.string(),
  vendorId: z.string(),
  vendorName: z.string(),
  title: z.string(),
  detail: z.string(),
  /** When the condition is dated (a trial end), the date. */
  dueAt: z.string().nullable(),
  /** The evidence birdsI would need to turn this into an alert, in plain words. */
  needs: z.string().nullable(),
});
export type Watch = z.infer<typeof Watch>;

/** How long a counted limit lasts at the observed rate. */
export const Runway = z.object({
  metric: z.string(),
  label: z.string(),
  perDay: z.number(),
  runsOutAt: z.string().nullable(),
  daysLeft: z.number().nullable(),
  observations: z.number().int(),
});
export type Runway = z.infer<typeof Runway>;

export const QuestionStatus = z.enum(["open", "answered", "dismissed"]);
export type QuestionStatus = z.infer<typeof QuestionStatus>;

export const Question = z.object({
  id: z.string(),
  repoId: z.string(),
  vendorId: z.string().nullable(),
  vendorName: z.string().nullable(),
  /** Who needs the answer: birdsI itself, or a coding agent through MCP. */
  askedBy: z.enum(["birdsi", "agent"]),
  question: z.string(),
  why: z.string(),
  /** When answering means choosing: the options, in display order. */
  options: z.array(z.string()),
  /** Where the owner can find the answer, when birdsI knows. */
  lookupUrl: z.string().nullable(),
  /** What the answer updates: a vendor fact metric, or free text for the agent. */
  updates: z.object({ kind: FactKind, metric: z.string(), label: z.string(), unit: z.string().nullable() }).nullable(),
  answer: z.string().nullable(),
  status: QuestionStatus,
  createdAt: z.string(),
  answeredAt: z.string().nullable(),
});
export type Question = z.infer<typeof Question>;

export const ActionStatus = z.enum(["pending", "approved", "denied", "executed", "failed", "expired"]);
export type ActionStatus = z.infer<typeof ActionStatus>;

/**
 * Something an agent wants done outside the code: a command on the owner's
 * machine (for example a Stripe Projects upgrade), or a change at a vendor.
 * Nothing runs until a person approves, unless the repo's policy says the
 * cost is small enough to auto-approve.
 */
export const ActionRequest = z.object({
  id: z.string(),
  repoId: z.string(),
  vendorId: z.string().nullable(),
  vendorName: z.string().nullable(),
  requestedBy: z.enum(["agent", "birdsi", "owner"]),
  title: z.string(),
  reason: z.string(),
  /** The exact command to run on the owner's machine after approval. */
  command: z.string(),
  /** Recurring monthly cost this adds, in US dollars, when known. */
  estimatedMonthlyUsd: z.number().nullable(),
  /** One-off cost in US dollars, when known. */
  estimatedOnceUsd: z.number().nullable(),
  status: ActionStatus,
  autoApproved: z.boolean(),
  decidedAt: z.string().nullable(),
  /** Output of the command once it ran. */
  result: z.string().nullable(),
  createdAt: z.string(),
  expiresAt: z.string(),
});
export type ActionRequest = z.infer<typeof ActionRequest>;

export const AgentPolicy = z.object({
  repoId: z.string(),
  /** Agents may read the inventory, facts, vision and alerts. Always true today; kept explicit for the paid layer. */
  allowRead: z.boolean(),
  /** Agents may queue questions and action requests. */
  allowPropose: z.boolean(),
  /** Agents may write to the record: decisions, facts in their own name, fixed marks. Every write is logged with its author. */
  allowWrite: z.boolean(),
  /** Requests at or under this monthly cost are approved without asking. Null means always ask. */
  autoApproveUnderUsd: z.number().nullable(),
  /** Commands that may be auto-approved must start with one of these. */
  autoApprovePrefixes: z.array(z.string()),
  updatedAt: z.string(),
});
export type AgentPolicy = z.infer<typeof AgentPolicy>;

/** The only programs an approved command may start. Everything else is refused when requested and when run. */
export const ALLOWED_COMMANDS = ["stripe", "npm", "npx", "pnpm", "yarn", "bun", "vercel", "supabase", "railway", "fly", "flyctl", "gh", "git", "node"] as const;

export function commandProgram(command: string): string {
  return command.trim().split(/\s+/)[0] ?? "";
}

export function isAllowedCommand(command: string): boolean {
  const program = commandProgram(command);
  return (ALLOWED_COMMANDS as readonly string[]).includes(program) && !/[;&|`$<>\\]/.test(command) && !/\n/.test(command) && !/(^|\s)--?(output|out|o)(=|\s)/.test(command);
}

export const DEFAULT_AUTO_APPROVE_PREFIXES = ["stripe projects status", "stripe projects spend", "stripe projects catalog", "stripe projects llm-context"];

export const Vision = z.object({
  repoId: z.string(),
  text: z.string(),
  updatedAt: z.string().nullable(),
});
export type Vision = z.infer<typeof Vision>;

/** Hints the CLI collects on the owner's machine and sends with a snapshot. */
export const ProjectHints = z.object({
  /** Stripe Projects: the committed state file and the status and spend commands, when present. */
  stripeProjects: z
    .object({
      state: z.unknown().optional(),
      status: z.unknown().optional(),
      spend: z.unknown().optional(),
      collectedAt: z.string(),
    })
    .optional(),
});
export type ProjectHints = z.infer<typeof ProjectHints>;

/** The two things that go stale: the map of the code, and the reads of the vendor accounts. */
export const StageId = z.enum(["map", "reads"]);
export type StageId = z.infer<typeof StageId>;

export const StageState = z.object({
  id: StageId,
  label: z.string(),
  lastRunAt: z.string().nullable(),
  /** fresh: within its window; stale: older; never: not run. */
  freshness: z.enum(["fresh", "stale", "never", "running"]),
  detail: z.string(),
});
export type StageState = z.infer<typeof StageState>;

export const STAGE_LABEL: Record<StageId, string> = {
  map: "Map the code",
  reads: "Read the accounts",
};

/** How long a stage stays fresh, in hours. The worker reads accounts every hour, so two hours old is stale. */
export const STAGE_FRESH_HOURS: Record<StageId, number> = { map: 24 * 7, reads: 2 };

// API shapes

export const VendorsResponse = z.object({
  vendors: z.array(Vendor),
  alerts: z.array(Alert),
  watches: z.array(Watch),
  /** Runway per vendor id, for counted limits with enough history. */
  runways: z.record(z.string(), z.array(Runway)),
  stages: z.array(StageState),
  /** Monthly spend across vendors where known, in US dollars. */
  monthlyUsd: z.number().nullable(),
  syncRunning: z.boolean(),
  lastSyncAt: z.string().nullable(),
});
export type VendorsResponse = z.infer<typeof VendorsResponse>;

export const QuestionsResponse = z.object({ questions: z.array(Question) });
export type QuestionsResponse = z.infer<typeof QuestionsResponse>;

export const AnswerQuestionRequest = z.object({ answer: z.string().min(1).max(2000) });
export type AnswerQuestionRequest = z.infer<typeof AnswerQuestionRequest>;

export const AskOwnerRequest = z.object({
  question: z.string().min(1).max(1000),
  why: z.string().min(1).max(1000),
  options: z.array(z.string().max(200)).max(8).default([]),
  vendorSlug: z.string().max(80).optional(),
});
export type AskOwnerRequest = z.infer<typeof AskOwnerRequest>;

export const ActionsResponse = z.object({ actions: z.array(ActionRequest), policy: AgentPolicy });
export const PolicyResponse = z.object({ policy: AgentPolicy });
export type PolicyResponse = z.infer<typeof PolicyResponse>;
export type ActionsResponse = z.infer<typeof ActionsResponse>;

export const RequestActionRequest = z.object({
  title: z.string().min(1).max(200),
  reason: z.string().min(1).max(2000),
  command: z.string().min(1).max(1000),
  vendorSlug: z.string().max(80).optional(),
  estimatedMonthlyUsd: z.number().nonnegative().optional(),
  estimatedOnceUsd: z.number().nonnegative().optional(),
});
export type RequestActionRequest = z.infer<typeof RequestActionRequest>;

export const DecideActionRequest = z.object({ decision: z.enum(["approve", "deny"]) });
export type DecideActionRequest = z.infer<typeof DecideActionRequest>;

export const ReportActionRequest = z.object({ ok: z.boolean(), output: z.string().max(20_000) });
export type ReportActionRequest = z.infer<typeof ReportActionRequest>;

export const VisionResponse = z.object({ vision: Vision });
export type VisionResponse = z.infer<typeof VisionResponse>;

export const SetVisionRequest = z.object({ text: z.string().max(20_000) });
export type SetVisionRequest = z.infer<typeof SetVisionRequest>;

/** The sections of the cockpit whose model prompt the owner can add to, per app. The default text lives in the engine. */
export const PromptSection = z.enum(["reader", "purposes", "docs", "security"]);
export type PromptSection = z.infer<typeof PromptSection>;

export const PROMPT_SECTION_LABEL: Record<PromptSection, string> = {
  reader: "The model's reading of the code",
  purposes: "What each service is for",
  docs: "The docs check",
  security: "The security pass",
};

export const PROMPT_SECTION_INTRO: Record<PromptSection, string> = {
  reader: "What the model should know about this app when it looks for what the rules missed: its shape, the services it runs on, what to leave alone.",
  purposes: "How this app names its features, so the one-line purposes use your words.",
  docs: "What matters when a package is checked against its documentation: the frameworks and versions in play, what to leave alone.",
  security: "What a security pass should weigh for this app: users and accounts, payments, children's data, admin surfaces. It steers the model's security pass, which is not on in this version. The rules and databases run regardless.",
};

export const SavePromptRequest = z.object({ section: PromptSection, text: z.string().max(4000) });
export type SavePromptRequest = z.infer<typeof SavePromptRequest>;

/** The owner's addition to one section's prompt, as the newest prompt entry of the record. */
export const AppPrompt = z.object({ section: PromptSection, text: z.string(), updatedAt: z.string().nullable() });
export type AppPrompt = z.infer<typeof AppPrompt>;

/** The owner's additions by section, as the engine receives them. */
export type Prompts = Partial<Record<PromptSection, string>>;

export const UpdatePolicyRequest = z.object({
  allowPropose: z.boolean().optional(),
  allowWrite: z.boolean().optional(),
  autoApproveUnderUsd: z.number().nonnegative().nullable().optional(),
});
export type UpdatePolicyRequest = z.infer<typeof UpdatePolicyRequest>;

/**
 * The record: what was decided, stated, fixed, answered, approved and run for
 * one app, by whom and why. Append-only. Agents read it before acting and
 * write to it within the repo's policy.
 */
export const RecordKind = z.enum([
  "decision",
  "fact",
  "finding_fixed",
  "finding_dismissed",
  "finding_reopened",
  "fix_opened",
  "vision",
  "policy",
  "question_answered",
  "question_dismissed",
  "action_decided",
  "action_run",
  "project",
  "prompt",
]);
export type RecordKind = z.infer<typeof RecordKind>;

export const RECORD_KIND_LABEL: Record<RecordKind, string> = {
  decision: "Decision",
  fact: "Fact",
  finding_fixed: "Marked fixed",
  finding_dismissed: "Dismissed",
  finding_reopened: "Reopened",
  fix_opened: "Fix started",
  vision: "Vision",
  policy: "Policy",
  question_answered: "Answered",
  question_dismissed: "Question dismissed",
  action_decided: "Approval",
  action_run: "Ran",
  project: "Projects and keys",
  prompt: "Prompt",
};

export const RecordAuthorKind = z.enum(["owner", "agent", "birdsi"]);
export type RecordAuthorKind = z.infer<typeof RecordAuthorKind>;

export const RECORD_AUTHOR_LABEL: Record<RecordAuthorKind, string> = { owner: "you", agent: "your coding agent", birdsi: "birdsI" };

export const RecordEntry = z.object({
  id: z.string(),
  repoId: z.string(),
  kind: RecordKind,
  authorKind: RecordAuthorKind,
  authorLabel: z.string().nullable(),
  /** What it is about: a finding key, a vendor slug, a metric, a command. */
  subject: z.string().nullable(),
  text: z.string(),
  why: z.string().nullable(),
  data: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string(),
});
export type RecordEntry = z.infer<typeof RecordEntry>;

export const RecordResponse = z.object({ entries: z.array(RecordEntry) });
export type RecordResponse = z.infer<typeof RecordResponse>;
export const RecordEntryEnvelope = z.object({ entry: RecordEntry });

/** What an agent or the owner may write directly: a decision, or a fact about a vendor. */
export const WriteRecordRequest = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("decision"),
    text: z.string().min(1).max(2000),
    why: z.string().max(2000).optional(),
    subject: z.string().max(200).optional(),
  }),
  z.object({
    kind: z.literal("fact"),
    vendorSlug: z.string().min(1).max(80),
    factKind: FactKind,
    metric: z
      .string()
      .regex(/^[a-z0-9_]+$/)
      .max(60),
    label: z.string().min(1).max(120),
    value: z.string().min(1).max(200),
    numeric: z.number().optional(),
    unit: z.string().max(40).optional(),
    limitNumeric: z.number().optional(),
    why: z.string().max(2000).optional(),
  }),
]);
export type WriteRecordRequest = z.infer<typeof WriteRecordRequest>;

export const MarkFixedRequest = z.object({ note: z.string().max(1000).optional() });
export type MarkFixedRequest = z.infer<typeof MarkFixedRequest>;

/** The whole knowledge base of one repo in one call, for agents and for the export. */
export const InventoryResponse = z.object({
  repo: z.object({ id: z.string(), fullName: z.string(), branch: z.string() }),
  vision: Vision,
  vendors: z.array(Vendor),
  alerts: z.array(Alert),
  watches: z.array(Watch),
  stages: z.array(StageState),
  openQuestions: z.number().int().nonnegative(),
  pendingActions: z.number().int().nonnegative(),
  latestScan: z
    .object({ id: z.string(), kind: z.string(), finishedAt: z.string().nullable(), findings: z.number().int().nonnegative(), headline: z.string().nullable() })
    .nullable(),
  /** The latest decisions on record, newest first, so an agent never asks what was already decided. */
  decisions: z.array(RecordEntry).default([]),
  /** The app: its name, environments and vendor projects with each key's state (never a key). Null before the apps migration. */
  app: App.nullable().default(null),
});
export type InventoryResponse = z.infer<typeof InventoryResponse>;

/** What changed between two scans of one repository, by stable finding key. */
export const ChangesResponse = z.object({
  repoId: z.string(),
  from: z.object({ scanId: z.string(), finishedAt: z.string().nullable() }).nullable(),
  to: z.object({ scanId: z.string(), finishedAt: z.string().nullable() }),
  newFindings: z.array(z.object({ id: z.string(), key: z.string(), title: z.string(), severity: Severity, confidence: z.string(), path: z.string().nullable() })),
  resolved: z.array(z.object({ key: z.string(), title: z.string(), severity: Severity, path: z.string().nullable() })),
  stillOpen: z.number().int().nonnegative(),
  dismissed: z.number().int().nonnegative(),
});
export type ChangesResponse = z.infer<typeof ChangesResponse>;

/** The least a finding row needs to be compared across scans. */
export interface FindingLike {
  id: string;
  key: string;
  title: string;
  severity: Severity;
  confidence: string;
  status: string;
  path: string | null;
  /** The check that produced it, when known. */
  checkId?: string;
}

/** Checks removed in v3 with the model review. A map after v3 cannot produce their findings. */
export const RETIRED_CHECKS: readonly string[] = ["review", "crosscheck"];

/**
 * New, resolved and unchanged findings between two scans, by stable key.
 * Dismissed findings are neither new nor resolved; fixed ones are not open.
 * Findings of a retired check are left out when the later scan could not have
 * produced them, so they never show as resolved: their check is gone.
 */
export function diffFindings(fromAll: FindingLike[], to: FindingLike[]): Pick<ChangesResponse, "newFindings" | "resolved" | "stillOpen" | "dismissed"> {
  const laterHasRetired = to.some((f) => f.checkId !== undefined && RETIRED_CHECKS.includes(f.checkId));
  const from = laterHasRetired ? fromAll : fromAll.filter((f) => f.checkId === undefined || !RETIRED_CHECKS.includes(f.checkId));
  const fromKeys = new Set(from.map((f) => f.key));
  const toKeys = new Set(to.map((f) => f.key));
  const open = to.filter((f) => f.status !== "dismissed" && f.status !== "fixed");
  return {
    newFindings: open.filter((f) => !fromKeys.has(f.key)).map(({ id, key, title, severity, confidence, path }) => ({ id, key, title, severity, confidence, path })),
    resolved: from.filter((f) => !toKeys.has(f.key) && f.status !== "dismissed").map(({ key, title, severity, path }) => ({ key, title, severity, path })),
    stillOpen: open.filter((f) => fromKeys.has(f.key)).length,
    dismissed: to.filter((f) => f.status === "dismissed").length,
  };
}
