import { z } from "zod";

/**
 * The alert stream: what needs the owner across an app, stored, one row per
 * cause, closed when a later read shows the cause has cleared. Each alert is
 * one sentence a founder can act on: the object, who or what acted on it, the
 * rule with its numbers, and the result. Written by the hourly read from the
 * service map, the project reads, the account facts and the dates to watch.
 */

export const AppAlertKind = z.enum(["project_paused", "deployment_failed", "cron_missing", "env_missing", "migration_owed", "plan_limit", "deadline", "read_failed", "limits_drift", "ci_failed", "secret_alert", "dependency_alert", "code_alert", "store_rejected", "build_failed"]);
export type AppAlertKind = z.infer<typeof AppAlertKind>;

export const ALERT_KIND_LABEL: Record<AppAlertKind, string> = {
  project_paused: "Paused project",
  deployment_failed: "Failed deployment",
  cron_missing: "Cron not running",
  env_missing: "Env name missing",
  migration_owed: "Migration owed",
  plan_limit: "Plan limit",
  deadline: "Date",
  read_failed: "Could not read",
  limits_drift: "Pricing page changed",
  ci_failed: "CI failed",
  secret_alert: "Secret in the code",
  dependency_alert: "Vulnerable dependency",
  code_alert: "Code scanning alert",
  store_rejected: "App Review rejected",
  build_failed: "Build failed",
};

export const AlertSeverity = z.enum(["critical", "warning", "notice"]);
export type AlertSeverity = z.infer<typeof AlertSeverity>;

/** Where the alert's evidence is: a vendor page, a file and line of the app's code, or both. */
export const AlertSource = z.object({
  label: z.string(),
  url: z.string().nullable(),
  path: z.string().nullable(),
  line: z.number().int().nullable(),
});
export type AlertSource = z.infer<typeof AlertSource>;

export const AlertDraft = z.object({
  kind: AppAlertKind,
  severity: AlertSeverity,
  /** The app project it is about, when it is about one. */
  projectId: z.string().nullable(),
  sentence: z.string(),
  /** What to do, in one short sentence, when there is something to do. */
  action: z.string().nullable(),
  details: z.record(z.string(), z.unknown()),
  source: AlertSource,
  /** One cause: the same key on the next read is the same alert. */
  dedupeKey: z.string(),
  /** What was checked to find it: an open alert whose scope was checked again and not found is closed. */
  scope: z.string(),
});
export type AlertDraft = z.infer<typeof AlertDraft>;

export const AppAlert = AlertDraft.extend({
  id: z.string(),
  appId: z.string(),
  openedAt: z.string(),
  seenAt: z.string(),
  resolvedAt: z.string().nullable(),
  /** "sent", or why it was not sent. */
  emailStatus: z.string().nullable(),
  emailedAt: z.string().nullable(),
});
export type AppAlert = z.infer<typeof AppAlert>;

/** A date the owner asked to be warned about: a trial that ends, a credit that runs out. */
export const AppDeadline = z.object({
  id: z.string(),
  appId: z.string(),
  vendor: z.string().nullable(),
  label: z.string(),
  dueOn: z.string(),
  note: z.string().nullable(),
  createdAt: z.string(),
});
export type AppDeadline = z.infer<typeof AppDeadline>;

export const AddDeadlineRequest = z.object({
  label: z.string().trim().min(2).max(120),
  dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A date as YYYY-MM-DD."),
  vendor: z.string().trim().max(40).nullable().default(null),
  note: z.string().trim().max(300).nullable().default(null),
});
export type AddDeadlineRequest = z.infer<typeof AddDeadlineRequest>;

/** Whether alerts are emailed, in one sentence the page shows. */
export const AlertEmailState = z.object({ on: z.boolean(), sentence: z.string() });
export type AlertEmailState = z.infer<typeof AlertEmailState>;

/** GET /api/v1/repos/:repoId/alerts: open alerts first, newest first, then the recently closed. */
export const AlertsResponse = z.object({
  alerts: z.array(AppAlert),
  deadlines: z.array(AppDeadline),
  email: AlertEmailState,
  reason: z.string().nullable(),
});
export type AlertsResponse = z.infer<typeof AlertsResponse>;

export const ALERT_SEVERITY_ORDER: Record<AlertSeverity, number> = { critical: 0, warning: 1, notice: 2 };

/** The scope of a dedupe key: its first two parts, kind and subject. */
export function scopeOf(dedupeKey: string): string {
  return dedupeKey.split(":").slice(0, 2).join(":");
}

export function maskEmail(email: string): string {
  const [name, domain] = email.split("@");
  if (!name || !domain) return email;
  return `${name.slice(0, 1)}${"*".repeat(Math.max(1, Math.min(6, name.length - 1)))}@${domain}`;
}

/** Whether new alerts are emailed to this owner, in one sentence: the key on birdsI, an address, and the owner's choice in Settings. */
export function alertEmailState(resendKeySet: boolean, user: { email: string | null; email_updates: boolean }): AlertEmailState {
  if (!resendKeySet) return { on: false, sentence: "Alerts are not emailed: RESEND_API_KEY is not set on birdsI." };
  if (!user.email) return { on: false, sentence: "Alerts are not emailed: the account has no email address." };
  if (!user.email_updates) return { on: false, sentence: "Alerts are not emailed: email alerts are off in Settings." };
  return { on: true, sentence: `New alerts are emailed to ${maskEmail(user.email)}.` };
}
