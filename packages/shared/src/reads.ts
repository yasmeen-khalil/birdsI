import { z } from "zod";

/**
 * What birdsI read from one vendor project with its read key. A read has
 * parts (a Vercel project's deployments, its env names, its crons, ...), and
 * each part is a Reading: its value with the time it was read and where it
 * came from, or the reason it could not be read. A part that could not be
 * read is never shown as a zero.
 */

export const ReadSource = z.object({
  /** The vendor API address read, never with a key in it. */
  api: z.string(),
  /** The page in the vendor's dashboard that shows the same thing, when there is one. */
  page: z.string().nullable(),
});
export type ReadSource = z.infer<typeof ReadSource>;

export type Reading<T> =
  | { ok: true; readAt: string; source: ReadSource; value: T }
  | { ok: false; readAt: string; source: ReadSource; reason: string };

export function readingOf<T extends z.ZodTypeAny>(value: T) {
  return z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), readAt: z.string(), source: ReadSource, value }),
    z.object({ ok: z.literal(false), readAt: z.string(), source: ReadSource, reason: z.string() }),
  ]);
}

/* ---------------------------------------------------------------- Vercel */

export const VercelDeploymentState = z.enum(["BUILDING", "ERROR", "INITIALIZING", "QUEUED", "READY", "CANCELED", "BLOCKED", "DELETED", "UNKNOWN"]);
export type VercelDeploymentState = z.infer<typeof VercelDeploymentState>;

export const VercelDeployment = z.object({
  id: z.string(),
  url: z.string().nullable(),
  state: VercelDeploymentState,
  /** production, preview, or a custom environment's name. */
  target: z.string(),
  createdAt: z.string(),
  readyAt: z.string().nullable(),
  commitSha: z.string().nullable(),
  /** The first line of the commit message, at most 120 characters. */
  commitMessage: z.string().nullable(),
  branch: z.string().nullable(),
  errorMessage: z.string().nullable(),
  inspectorUrl: z.string().nullable(),
});
export type VercelDeployment = z.infer<typeof VercelDeployment>;

/** An env variable's name and where it applies. Never its value. */
export const VercelEnvName = z.object({
  key: z.string(),
  targets: z.array(z.string()),
  type: z.string(),
  gitBranch: z.string().nullable(),
  updatedAt: z.string().nullable(),
});
export type VercelEnvName = z.infer<typeof VercelEnvName>;

export const VercelCrons = z.object({
  /** False when the project's crons are switched off in its settings. */
  enabled: z.boolean(),
  definitions: z.array(z.object({ path: z.string(), schedule: z.string() })),
  updatedAt: z.string().nullable(),
  deploymentId: z.string().nullable(),
});
export type VercelCrons = z.infer<typeof VercelCrons>;

export const VercelDomain = z.object({
  name: z.string(),
  verified: z.boolean().nullable(),
  redirect: z.string().nullable(),
  gitBranch: z.string().nullable(),
});
export type VercelDomain = z.infer<typeof VercelDomain>;

export const VercelLogLine = z.object({
  at: z.string(),
  deploymentId: z.string(),
  /** build: from the deployment's build output. runtime: from its functions. */
  from: z.enum(["build", "runtime"]),
  /** Masked, at most 300 characters. */
  text: z.string(),
});
export type VercelLogLine = z.infer<typeof VercelLogLine>;

export const VercelProjectInfo = z.object({
  id: z.string(),
  name: z.string(),
  framework: z.string().nullable(),
  productionUrl: z.string().nullable(),
  /** True when Vercel says the project is paused, null when the answer does not say. */
  paused: z.boolean().nullable(),
  /** The folder of the repository the project builds: "" for the root, null when Vercel's answer does not say. */
  rootDirectory: z.string().nullable(),
  createdAt: z.string().nullable(),
});
export type VercelProjectInfo = z.infer<typeof VercelProjectInfo>;

/** When the key birdsI reads the project with stops working, as Vercel says. */
export const VercelKeyExpiry = z.object({ expiresAt: z.string().nullable() });
export type VercelKeyExpiry = z.infer<typeof VercelKeyExpiry>;

export const VercelRead = z.object({
  vendor: z.literal("vercel"),
  project: readingOf(VercelProjectInfo),
  deployments: readingOf(z.array(VercelDeployment)),
  env: readingOf(z.array(VercelEnvName)),
  crons: readingOf(VercelCrons.nullable()),
  domains: readingOf(z.array(VercelDomain)),
  errors: readingOf(z.array(VercelLogLine)),
  keyExpiry: readingOf(VercelKeyExpiry),
});
export type VercelRead = z.infer<typeof VercelRead>;

/* -------------------------------------------------------------- Supabase */

export const SupabaseProjectInfo = z.object({
  ref: z.string(),
  name: z.string(),
  region: z.string().nullable(),
  /** Supabase's own word: ACTIVE_HEALTHY, INACTIVE (paused), PAUSING, RESTORING, ... */
  status: z.string(),
  paused: z.boolean(),
  createdAt: z.string().nullable(),
  postgresVersion: z.string().nullable(),
});
export type SupabaseProjectInfo = z.infer<typeof SupabaseProjectInfo>;

export const AdvisorLint = z.object({
  name: z.string(),
  title: z.string(),
  level: z.enum(["ERROR", "WARN", "INFO"]),
  /** What it found, masked, at most 300 characters. */
  detail: z.string(),
  remediation: z.string().nullable(),
});
export type AdvisorLint = z.infer<typeof AdvisorLint>;

export const OwedMigration = z.object({
  /** The file the markers name, or the marker's own label when no file matches. */
  migration: z.string(),
  file: z.string().nullable(),
  /** What the database lacks, in words: "the table cron_runs". */
  missing: z.array(z.string()),
});
export type OwedMigration = z.infer<typeof OwedMigration>;

export const MigrationCheck = z.object({
  method: z.enum(["markers", "history", "none"]),
  /** How the check was made, or why it could not be, in one sentence. */
  how: z.string(),
  checked: z.number().int().nonnegative(),
  owed: z.array(OwedMigration),
  /** Markers of a kind birdsI cannot check, as written. */
  unknown: z.array(z.string()),
});
export type MigrationCheck = z.infer<typeof MigrationCheck>;

export const SupabaseRead = z.object({
  vendor: z.literal("supabase"),
  project: readingOf(SupabaseProjectInfo),
  size: readingOf(z.object({ bytes: z.number().nonnegative() })),
  security: readingOf(z.array(AdvisorLint)),
  performance: readingOf(z.array(AdvisorLint)),
  migrations: readingOf(MigrationCheck),
});
export type SupabaseRead = z.infer<typeof SupabaseRead>;

/* ------------------------------------------------------------- OneSignal */

export const OneSignalAppInfo = z.object({
  id: z.string(),
  name: z.string(),
  /** Every subscription the app has. */
  subscriptions: z.number().int().nonnegative().nullable(),
  /** Subscriptions that can receive a message now. */
  subscribed: z.number().int().nonnegative().nullable(),
  /** The platforms the app is set up to send to: ios, android, web, ... */
  platforms: z.array(z.string()),
  updatedAt: z.string().nullable(),
});
export type OneSignalAppInfo = z.infer<typeof OneSignalAppInfo>;

/**
 * OneSignal's own counts, in its words: successful is delivered to the push
 * services, failed is subscriptions found unsubscribed, errored is delivery
 * errors, converted is clicks, received is confirmed deliveries (paid plans).
 */
export const DeliveryCounts = z.object({
  successful: z.number().int().nonnegative().nullable(),
  failed: z.number().int().nonnegative().nullable(),
  errored: z.number().int().nonnegative().nullable(),
  converted: z.number().int().nonnegative().nullable(),
  received: z.number().int().nonnegative().nullable(),
});
export type DeliveryCounts = z.infer<typeof DeliveryCounts>;

export const OneSignalNotification = z.object({
  id: z.string(),
  /** dashboard, api, automated, or unknown. */
  kind: z.string(),
  /** The campaign's name or English heading for dashboard sends; nothing for sends to one person. */
  title: z.string().nullable(),
  sentAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  canceled: z.boolean(),
  remaining: z.number().int().nonnegative().nullable(),
  totals: DeliveryCounts,
  platforms: z.record(z.string(), DeliveryCounts),
});
export type OneSignalNotification = z.infer<typeof OneSignalNotification>;

/** Who a send to everyone would reach now, from OneSignal's estimate, which sends nothing. */
export const OneSignalAudience = z.object({
  /** Push subscriptions a send to every subscriber would reach. */
  pushRecipients: z.number().int().nonnegative().nullable(),
  /** True when OneSignal would drop mobile push because the organization is over its plan's cap. */
  mobileSuppressed: z.boolean().nullable(),
});
export type OneSignalAudience = z.infer<typeof OneSignalAudience>;

export const OneSignalRead = z.object({
  vendor: z.literal("onesignal"),
  app: readingOf(OneSignalAppInfo),
  audience: readingOf(OneSignalAudience),
  notifications: readingOf(z.object({ total: z.number().int().nonnegative().nullable(), recent: z.array(OneSignalNotification) })),
});
export type OneSignalRead = z.infer<typeof OneSignalRead>;

/* ------------------------------------------------------------------ Reads */

export const ProjectReadData = z.discriminatedUnion("vendor", [VercelRead, SupabaseRead, OneSignalRead]);
export type ProjectReadData = z.infer<typeof ProjectReadData>;

/** The vendors and project kinds birdsI reads in depth. */
export const DEEP_READS: ReadonlyArray<{ vendor: ProjectReadData["vendor"]; kind: string }> = [
  { vendor: "vercel", kind: "project" },
  { vendor: "supabase", kind: "project" },
  { vendor: "onesignal", kind: "app" },
];

export function readsInDepth(vendor: string, kind: string): boolean {
  return DEEP_READS.some((d) => d.vendor === vendor && d.kind === kind);
}

/** The parts of a read, for counting the ones that could not be read. */
export function readParts(data: ProjectReadData): Array<{ name: string; reading: Reading<unknown> }> {
  return Object.entries(data)
    .filter(([name]) => name !== "vendor")
    .map(([name, reading]) => ({ name, reading: reading as Reading<unknown> }));
}

export const ProjectRead = z.object({
  id: z.string(),
  appId: z.string(),
  projectId: z.string(),
  vendor: z.string(),
  readAt: z.string(),
  problems: z.number().int().nonnegative(),
  data: ProjectReadData,
});
export type ProjectRead = z.infer<typeof ProjectRead>;

/** GET /api/v1/repos/:repoId/reads: the newest read of each project, and why there is none when there is none. */
export const ReadsResponse = z.object({
  reads: z.array(ProjectRead),
  reason: z.string().nullable(),
});
export type ReadsResponse = z.infer<typeof ReadsResponse>;
