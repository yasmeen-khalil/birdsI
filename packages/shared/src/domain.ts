import { z } from "zod";

/**
 * Core domain vocabulary. Internal names are stable forever; the user-facing
 * words live in the copy dictionary and may differ.
 */

export const ScanKind = z.enum(["light", "deep", "audit"]);
export type ScanKind = z.infer<typeof ScanKind>;

export const ScanStatus = z.enum(["queued", "running", "done", "failed", "stopped"]);
export type ScanStatus = z.infer<typeof ScanStatus>;

export const ScanSource = z.enum(["web", "cli", "mcp", "demo"]);
export type ScanSource = z.infer<typeof ScanSource>;

export const Severity = z.enum(["critical", "high", "medium", "low"]);
export type Severity = z.infer<typeof Severity>;
export const SEVERITY_ORDER: readonly Severity[] = ["critical", "high", "medium", "low"];

/**
 * How sure birdsI is. Drawn as line in the UI, never as colour.
 * proven: a deterministic tool or rule established it.
 * doc_verified: checked against a current official document, which is cited.
 * judgment: the model's reading of the code. Worth checking.
 */
export const Confidence = z.enum(["proven", "doc_verified", "judgment"]);
export type Confidence = z.infer<typeof Confidence>;
export const CONFIDENCE_ORDER: readonly Confidence[] = ["proven", "doc_verified", "judgment"];

export const FindingCategory = z.enum([
  "security",
  "dependency",
  "contradiction",
  "inconsistency",
  "gap",
  "docs",
  "config",
]);
export type FindingCategory = z.infer<typeof FindingCategory>;

/** Who acts on a finding: birdsI opens a pull request, or the developer follows steps. */
export const ActionKind = z.enum(["fix", "steps"]);
export type ActionKind = z.infer<typeof ActionKind>;

export const FindingStatus = z.enum(["open", "pr_open", "fixed", "dismissed"]);
export type FindingStatus = z.infer<typeof FindingStatus>;

export const Location = z.object({
  path: z.string(),
  lineStart: z.number().int().positive().optional(),
  lineEnd: z.number().int().positive().optional(),
});
export type Location = z.infer<typeof Location>;

export const DocReference = z.object({
  url: z.url(),
  title: z.string(),
  /** The passage the finding rests on, quoted so the user can check it. */
  excerpt: z.string(),
  publishedAt: z.string().optional(),
});
export type DocReference = z.infer<typeof DocReference>;

export const Evidence = z.object({
  /** Code excerpt, with line numbers relative to lineStart. */
  excerpt: z.string().optional(),
  doc: DocReference.optional(),
  /** Advisory ids (OSV, GHSA, CVE) when a database established the finding. */
  advisories: z.array(z.string()).default([]),
  /** The rule or tool that proved it, for proven findings. */
  rule: z.string().optional(),
});
export type Evidence = z.infer<typeof Evidence>;

export const Step = z.object({
  title: z.string(),
  detail: z.string().optional(),
  /** A snippet the user can copy (a command, SQL, a config line). */
  snippet: z.string().optional(),
  snippetLanguage: z.string().optional(),
});
export type Step = z.infer<typeof Step>;

export const FixPlan = z.object({
  summary: z.string(),
  /** Paths the fix touches. The patch itself is produced when the fix runs. */
  paths: z.array(z.string()),
  /** Things the user still has to do after the pull request merges. */
  followUp: z.array(z.string()).default([]),
});
export type FixPlan = z.infer<typeof FixPlan>;

export const Finding = z.object({
  id: z.string(),
  scanId: z.string(),
  repoId: z.string().nullable(),
  /** Stable across scans of the same repo: same check, same place, same subject. */
  key: z.string(),
  checkId: z.string(),
  title: z.string(),
  explanation: z.string(),
  whyItMatters: z.string(),
  severity: Severity,
  confidence: Confidence,
  category: FindingCategory,
  location: Location.nullable(),
  evidence: Evidence,
  actionKind: ActionKind,
  steps: z.array(Step).default([]),
  fixPlan: FixPlan.nullable(),
  status: FindingStatus,
  createdAt: z.string(),
});
export type Finding = z.infer<typeof Finding>;

/** What a check produces before the scan runner assigns ids and persistence. */
export const FindingDraft = Finding.omit({
  id: true,
  scanId: true,
  repoId: true,
  status: true,
  createdAt: true,
});
export type FindingDraft = z.infer<typeof FindingDraft>;

export const Ecosystem = z.enum([
  "npm",
  "PyPI",
  "Go",
  "crates.io",
  "RubyGems",
  "Packagist",
  "Maven",
  "NuGet",
  "Hex",
  "Pub",
]);
export type Ecosystem = z.infer<typeof Ecosystem>;

export const Vulnerability = z.object({
  id: z.string(),
  aliases: z.array(z.string()).default([]),
  summary: z.string(),
  severity: Severity,
  fixedIn: z.string().nullable(),
  url: z.url(),
});
export type Vulnerability = z.infer<typeof Vulnerability>;

export const DocsCheck = z.object({
  status: z.enum(["current", "behind", "deprecated", "unknown"]),
  note: z.string().optional(),
  doc: DocReference.optional(),
  checkedAt: z.string(),
});
export type DocsCheck = z.infer<typeof DocsCheck>;

export const Dependency = z.object({
  ecosystem: Ecosystem,
  name: z.string(),
  versionInUse: z.string(),
  latestVersion: z.string().nullable(),
  manifestPath: z.string(),
  direct: z.boolean(),
  vulnerabilities: z.array(Vulnerability).default([]),
  docsCheck: DocsCheck.nullable(),
});
export type Dependency = z.infer<typeof Dependency>;

export const ScanStats = z.object({
  filesSeen: z.number().int().nonnegative(),
  filesRead: z.number().int().nonnegative(),
  checksRun: z.number().int().nonnegative(),
  dependencies: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  /** Whole microdollars, so sums stay exact. */
  costMicrodollars: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
});
export type ScanStats = z.infer<typeof ScanStats>;

export const ScanSummary = z.object({
  headline: z.string(),
  bySeverity: z.record(Severity, z.number().int().nonnegative()),
  byConfidence: z.record(Confidence, z.number().int().nonnegative()),
  fixable: z.number().int().nonnegative(),
  needsYou: z.number().int().nonnegative(),
  /** Finding ids the user should start with, in order. */
  startWith: z.array(z.string()),
});
export type ScanSummary = z.infer<typeof ScanSummary>;

export const AuditVerdict = z.enum(["ready", "not_ready", "not_run"]);
export type AuditVerdict = z.infer<typeof AuditVerdict>;

export const AUDIT_AREAS = [
  "auth",
  "secrets",
  "data",
  "dependencies",
  "errors",
  "config",
  "legal",
  "tests",
] as const;
export const AuditArea = z.enum(AUDIT_AREAS);
export type AuditArea = z.infer<typeof AuditArea>;

export const AuditAreaResult = z.object({
  area: AuditArea,
  verdict: z.enum(["pass", "attention", "blocker"]),
  note: z.string(),
  findingIds: z.array(z.string()),
});
export type AuditAreaResult = z.infer<typeof AuditAreaResult>;

export const AuditReport = z.object({
  verdict: AuditVerdict,
  headline: z.string(),
  areas: z.array(AuditAreaResult),
  blockers: z.array(z.string()),
  fixBeforeLaunch: z.array(z.string()),
  canWait: z.array(z.string()),
});
export type AuditReport = z.infer<typeof AuditReport>;

export const Scan = z.object({
  id: z.string(),
  repoId: z.string().nullable(),
  kind: ScanKind,
  status: ScanStatus,
  source: ScanSource,
  branch: z.string().nullable(),
  commitSha: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  error: z.string().nullable(),
  summary: ScanSummary.nullable(),
  audit: AuditReport.nullable(),
  stats: ScanStats.nullable(),
  createdAt: z.string(),
});
export type Scan = z.infer<typeof Scan>;

export const Repo = z.object({
  id: z.string(),
  fullName: z.string(),
  defaultBranch: z.string(),
  private: z.boolean(),
  installationId: z.string().nullable(),
  createdAt: z.string(),
});
export type Repo = z.infer<typeof Repo>;

export const FixStatus = z.enum(["proposed", "testing", "tested", "pr_open", "failed"]);
export type FixStatus = z.infer<typeof FixStatus>;

export const Fix = z.object({
  id: z.string(),
  findingId: z.string(),
  status: FixStatus,
  patch: z.string().nullable(),
  testLog: z.string().nullable(),
  prNumber: z.number().int().nullable(),
  prUrl: z.url().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Fix = z.infer<typeof Fix>;
