import { z } from "zod";

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
export const FactSource = z.enum(["static", "connector", "docs", "estimate", "asked"]);
export type FactSource = z.infer<typeof FactSource>;

export const FACT_SOURCE_LABEL: Record<FactSource, string> = {
  static: "Found in the code",
  connector: "From the connected account",
  docs: "From the vendor's current docs",
  estimate: "Estimated by birdsI",
  asked: "You told birdsI",
};

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

export const PlanTier = z.object({
  name: z.string(),
  /** Monthly price in US dollars, null for usage-based or custom. */
  priceUsd: z.number().nullable(),
  priceNote: z.string().nullable(),
  limits: z.array(z.object({ metric: z.string(), label: z.string(), amount: z.number().nullable(), unit: z.string().nullable(), note: z.string().nullable() })),
});
export type PlanTier = z.infer<typeof PlanTier>;

/** Knowledge about a vendor that is true for every app: what it is, its tiers. Cached and refreshed. */
export const VendorKnowledge = z.object({
  slug: z.string(),
  name: z.string(),
  what: z.string(),
  pricingUrl: z.string().nullable(),
  tiers: z.array(PlanTier),
  /** The documents the tiers were read from. */
  sources: z.array(z.object({ url: z.string(), title: z.string(), publishedAt: z.string().optional() })),
  fetchedAt: z.string(),
});
export type VendorKnowledge = z.infer<typeof VendorKnowledge>;

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
});
export type Alert = z.infer<typeof Alert>;

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
  /** Requests at or under this monthly cost are approved without asking. Null means always ask. */
  autoApproveUnderUsd: z.number().nullable(),
  /** Commands that may be auto-approved must start with one of these. */
  autoApprovePrefixes: z.array(z.string()),
  updatedAt: z.string(),
});
export type AgentPolicy = z.infer<typeof AgentPolicy>;

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

/** The pipeline stages in dependency order, with when each last ran. */
export const StageId = z.enum(["inventory", "docs", "audit", "ops"]);
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
  inventory: "Map the code",
  docs: "Check current docs",
  audit: "Audit the code",
  ops: "Sync vendors and limits",
};

/** How long a stage stays fresh, in hours. */
export const STAGE_FRESH_HOURS: Record<StageId, number> = { inventory: 24, docs: 24 * 7, audit: 24, ops: 24 };

// API shapes

export const VendorsResponse = z.object({
  vendors: z.array(Vendor),
  alerts: z.array(Alert),
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

export const UpdatePolicyRequest = z.object({
  allowPropose: z.boolean().optional(),
  autoApproveUnderUsd: z.number().nonnegative().nullable().optional(),
});
export type UpdatePolicyRequest = z.infer<typeof UpdatePolicyRequest>;

/** The whole knowledge base of one repo in one call, for agents and for the export. */
export const InventoryResponse = z.object({
  repo: z.object({ id: z.string(), fullName: z.string(), branch: z.string() }),
  vision: Vision,
  vendors: z.array(Vendor),
  alerts: z.array(Alert),
  stages: z.array(StageState),
  openQuestions: z.number().int().nonnegative(),
  pendingActions: z.number().int().nonnegative(),
  latestScan: z
    .object({ id: z.string(), kind: z.string(), finishedAt: z.string().nullable(), findings: z.number().int().nonnegative(), headline: z.string().nullable() })
    .nullable(),
});
export type InventoryResponse = z.infer<typeof InventoryResponse>;
