import { bestFacts, checkedLimit, envNeededBy, LIMITS_BY_SLUG, missingEnv, roleForLabel, tierFor } from "@birdsi/shared";
import type { AlertDraft, AppAlertKind, AppDeadline, LimitsDrift, MapEnv, ProjectReadData, ServiceMap, SupabaseRead, Vendor, VendorFact, VercelRead, OneSignalRead } from "@birdsi/shared";

/**
 * The alert rules of the cockpit. Each alert is one sentence the owner can
 * act on: the object, who or what acted on it, the rule with its numbers, and
 * the result. Pure: the read job stores what this returns, opens what is new
 * and closes what a checked scope no longer finds.
 */

export interface AlertProject {
  id: string;
  vendor: string;
  kind: string;
  ref: string;
  label: string | null;
  plan: string | null;
  dashboardUrl: string;
}

export interface AlertInput {
  app: { name: string; environments: string[] };
  projects: AlertProject[];
  map: ServiceMap | null;
  /** The newest read of each project, by project id. */
  reads: Map<string, ProjectReadData>;
  /** The app's vendors with their facts, for plan limits. */
  vendors: Vendor[];
  deadlines: AppDeadline[];
  /** The newest check of each pricing page the checked limits list rests on, for the vendors this app uses. */
  drift?: LimitsDrift[];
  /** A failed deployment explained by the model, by project id, written into the alert's details. */
  explanations?: Map<string, { text: string; model: string }>;
  now: Date;
}

export interface AlertResult {
  drafts: AlertDraft[];
  /** The scopes this run could check: an open alert in one of them that was not found again is closed. */
  checked: string[];
}

const DAY = 86_400_000;
/** More missing env names than this on one project and environment become one alert. */
const ENV_ALERTS_PER_PROJECT = 6;

export function dateWords(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export function ageWords(fromIso: string, now: Date): string {
  const ms = now.getTime() - Date.parse(fromIso);
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return minutes <= 1 ? "a minute ago" : `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return hours === 1 ? "an hour ago" : `${hours} hours ago`;
  return `${Math.round(hours / 24)} days ago`;
}

/** Whole days from today (UTC) to a date: negative when it has passed. */
export function daysUntil(dateIso: string, now: Date): number {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const d = new Date(dateIso);
  const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round((day - today) / DAY);
}

function inDays(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

function listWords(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function projectName(p: AlertProject, read: ProjectReadData | undefined): string {
  if (read?.vendor === "vercel" && read.project.ok) return read.project.value.name;
  if (read?.vendor === "supabase" && read.project.ok) return read.project.value.name;
  if (read?.vendor === "onesignal" && read.app.ok) return read.app.value.name;
  return p.label && p.label !== p.ref ? `${p.ref} (${p.label})` : p.ref;
}

const VENDOR_NAME: Record<string, string> = { vercel: "Vercel", supabase: "Supabase", onesignal: "OneSignal" };

export function appAlerts(input: AlertInput): AlertResult {
  const drafts: AlertDraft[] = [];
  const checked = new Set<string>(["deadline:app"]);
  const { map, now } = input;

  for (const p of input.projects) {
    const read = input.reads.get(p.id);
    if (!read) continue;
    const name = projectName(p, read);
    const vendorName = VENDOR_NAME[p.vendor] ?? p.vendor;

    // A project no part of which could be read.
    const parts = Object.entries(read).filter(([k]) => k !== "vendor").map(([, v]) => v as { ok: boolean; reason?: string; readAt: string });
    checked.add(`read_failed:${p.id}`);
    if (parts.length > 0 && parts.every((r) => !r.ok)) {
      const reason = parts[0]!.reason ?? "no reason given";
      drafts.push({
        kind: "read_failed",
        severity: "warning",
        projectId: p.id,
        sentence: `birdsI could not read the ${vendorName} project ${name} ${ageWords(parts[0]!.readAt, now)}: ${reason.replace(/\.?$/, ".")} Nothing on this project is current until it can.`,
        action: "Check the key on the Projects page.",
        details: { reason },
        source: { label: `${vendorName} project ${name}`, url: p.dashboardUrl, path: null, line: null },
        dedupeKey: `read_failed:${p.id}`,
        scope: `read_failed:${p.id}`,
      });
      continue;
    }

    if (read.vendor === "vercel") vercelAlerts(drafts, checked, input, p, read, name);
    if (read.vendor === "supabase") supabaseAlerts(drafts, checked, input, p, read, name);
    if (read.vendor === "onesignal") oneSignalAlerts(drafts, checked, input, p, read, name);
  }

  planLimitAlerts(drafts, checked, input);
  deadlineAlerts(drafts, input);
  driftAlerts(drafts, checked, input);
  factAlerts(drafts, checked, input);
  webhookAlerts(drafts, checked, input);

  const order = { critical: 0, warning: 1, notice: 2 } as const;
  drafts.sort((a, b) => order[a.severity] - order[b.severity] || a.kind.localeCompare(b.kind) || a.dedupeKey.localeCompare(b.dedupeKey));
  return { drafts, checked: [...checked] };
}

function vercelAlerts(drafts: AlertDraft[], checked: Set<string>, input: AlertInput, p: AlertProject, read: VercelRead, name: string): void {
  const { map, now } = input;

  // The newest production deployment failed.
  if (read.deployments.ok) {
    checked.add(`deployment_failed:${p.id}`);
    const production = read.deployments.value.filter((d) => d.target === "production").sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    const newest = production[0];
    if (newest && newest.state === "ERROR") {
      const live = production.find((d) => d.state === "READY");
      const commit = newest.commitSha ? ` (commit ${newest.commitSha.slice(0, 7)}${newest.commitMessage ? `, "${newest.commitMessage}"` : ""})` : "";
      const says = newest.errorMessage ? `: Vercel says "${newest.errorMessage}"` : "";
      const result = live ? `Production still serves the deployment from ${dateWords(live.createdAt)}, so the changes in it are not live.` : "Production has no ready deployment.";
      drafts.push({
        kind: "deployment_failed",
        severity: "critical",
        projectId: p.id,
        sentence: `The newest production deployment of the Vercel project ${name} failed ${ageWords(newest.createdAt, now)}${commit}${says}. ${result}`,
        action: "Open the deployment, fix the build, and push again.",
        details: { deploymentId: newest.id, commitSha: newest.commitSha, errorMessage: newest.errorMessage, liveDeploymentId: live?.id ?? null, ...(input.explanations?.get(p.id) ? { explanation: input.explanations.get(p.id)!.text, explainedBy: input.explanations.get(p.id)!.model } : {}) },
        source: { label: "The deployment on Vercel", url: newest.inspectorUrl ?? read.deployments.source.page, path: null, line: null },
        dedupeKey: `deployment_failed:${p.id}:${newest.id}`,
        scope: `deployment_failed:${p.id}`,
      });
    }
  }

  // Crons in the code that Vercel does not run.
  if (read.crons.ok && map && map.crons.length > 0) {
    checked.add(`cron_missing:${p.id}`);
    const root = read.project.ok ? read.project.value.rootDirectory : null;
    const crons = map.crons.filter((c) => root === null || dirOf(c.source.path) === root);
    const registered = read.crons.value;
    if (registered && !registered.enabled && crons.length > 0) {
      drafts.push({
        kind: "cron_missing",
        severity: "warning",
        projectId: p.id,
        sentence: `Vercel has the crons of the project ${name} switched off, so ${listWords(crons.map((c) => c.path))} ${crons.length === 1 ? "does" : "do"} not run (${listWords(crons.map((c) => c.every))}, as ${crons[0]!.source.path} sets ${crons.length === 1 ? "it" : "them"}).`,
        action: "Turn the crons back on in the project's settings.",
        details: { paths: crons.map((c) => c.path) },
        source: { label: "Cron jobs on Vercel", url: read.crons.source.page, path: crons[0]!.source.path, line: crons[0]!.source.line },
        dedupeKey: `cron_missing:${p.id}:off`,
        scope: `cron_missing:${p.id}`,
      });
    } else {
      const paths = new Set((registered?.definitions ?? []).map((d) => d.path.split("?")[0]));
      for (const c of crons) {
        if (paths.has(c.path.split("?")[0]!)) continue;
        drafts.push({
          kind: "cron_missing",
          severity: "warning",
          projectId: p.id,
          sentence: `The cron ${c.path}, set to run ${c.every} at ${c.source.path}:${c.source.line}, is not registered on the Vercel project ${name}. Vercel registers crons from vercel.json when a production deployment succeeds, so it does not run until one does.`,
          action: "Deploy to production, then check the project's Cron Jobs settings.",
          details: { path: c.path, schedule: c.schedule },
          source: { label: "Cron jobs on Vercel", url: read.crons.source.page, path: c.source.path, line: c.source.line },
          dedupeKey: `cron_missing:${p.id}:${c.path}`,
          scope: `cron_missing:${p.id}`,
        });
      }
    }
  }

  // Env names the deployment's code needs that the project lacks.
  if (read.env.ok && map && map.env.length > 0) {
    checked.add(`env_missing:${p.id}`);
    const role = roleForLabel(p.label, map.roles);
    const needed = envNeededBy(map, role).required.filter((e) => e.areas.some((a) => a !== "declared"));
    const environments = input.app.environments.length > 0 ? input.app.environments : ["production"];
    for (const environment of environments) {
      const present = new Set(read.env.value.filter((e) => e.targets.includes(environment)).map((e) => e.key));
      const missing = missingEnv(needed, present);
      const where = role && map.roles.names.length > 1 ? `, which serves the ${role} deployment` : "";
      if (missing.length > ENV_ALERTS_PER_PROJECT) {
        drafts.push({
          kind: "env_missing",
          severity: "warning",
          projectId: p.id,
          sentence: `${missing.length} env names the code reads without a default are not set for ${environment} on the Vercel project ${name}${where}: ${listWords(missing.slice(0, 8).map((e) => e.name))}${missing.length > 8 ? ` and ${missing.length - 8} more` : ""}. In ${environment}, those reads find nothing.`,
          action: "Add them in the project's Environment Variables, or label the project with the deployment it serves.",
          details: { environment, role, names: missing.map((e) => e.name) },
          source: { label: "Environment variables on Vercel", url: read.env.source.page, path: null, line: null },
          dedupeKey: `env_missing:${p.id}:${environment}:many`,
          scope: `env_missing:${p.id}`,
        });
        continue;
      }
      for (const e of missing) {
        const at = readLine(map, e);
        const alt = e.alternatives.length > 0 ? `, or ${listWords(e.alternatives)} in its place,` : "";
        const how = at?.sdk
          ? `The ${at.sdk} SDK, imported at ${at.path}:${at.line}, reads it${alt} and finds nothing in ${environment}.`
          : at
            ? `The code reads it${alt} at ${at.path}:${at.line} without a default, so in ${environment} that read finds nothing.`
            : `The code reads it${alt} without a default, so in ${environment} that read finds nothing.`;
        drafts.push({
          kind: "env_missing",
          severity: "warning",
          projectId: p.id,
          sentence: `${e.name} is not set for ${environment} on the Vercel project ${name}${where}. ${how}`,
          action: `Add ${e.name} in the project's Environment Variables.`,
          details: { environment, role, name: e.name, areas: e.areas, alternatives: e.alternatives },
          source: { label: "Environment variables on Vercel", url: read.env.source.page, path: at?.path ?? null, line: at?.line ?? null },
          dedupeKey: `env_missing:${p.id}:${environment}:${e.name}`,
          scope: `env_missing:${p.id}`,
        });
      }
    }
  }

  // The key's expiry, as Vercel says it.
  if (read.keyExpiry.ok) {
    checked.add(`deadline:${p.id}`);
    const at = read.keyExpiry.value.expiresAt;
    const days = at ? daysUntil(at, now) : null;
    if (at && days !== null && days <= 30) {
      drafts.push({
        kind: "deadline",
        severity: days <= 7 ? "critical" : "warning",
        projectId: p.id,
        sentence: `The key birdsI reads the Vercel project ${name} with ${days < 0 ? "expired" : "expires"} on ${dateWords(at)}, ${inDays(days)}. ${days < 0 ? "Vercel now refuses it, and the project goes unread." : "After that Vercel refuses it, and the project goes unread."}`,
        action: "Make a new key on Vercel and replace it on the Projects page.",
        details: { expiresAt: at },
        source: { label: "Vercel tokens", url: read.keyExpiry.source.page, path: null, line: null },
        dedupeKey: `deadline:${p.id}:key:${at.slice(0, 10)}`,
        scope: `deadline:${p.id}`,
      });
    }
  }
}

function supabaseAlerts(drafts: AlertDraft[], checked: Set<string>, input: AlertInput, p: AlertProject, read: SupabaseRead, name: string): void {
  if (read.project.ok) {
    checked.add(`project_paused:${p.id}`);
    if (read.project.value.paused) {
      const plan = planOf(input.vendors, "supabase") ?? p.plan;
      const tier = plan ? tierFor(LIMITS_BY_SLUG.get("supabase")!, plan) : null;
      const pauses = tier?.conditions.find((c) => c.id === "pauses");
      const rule = pauses ? `on the ${tier!.name} plan, "${pauses.source.quote.replace(/\.$/, "")}"` : `its status is ${read.project.value.status}`;
      drafts.push({
        kind: "project_paused",
        severity: "critical",
        projectId: p.id,
        sentence: `Supabase paused the project ${name} that ${input.app.name} runs on (${rule}). Until it is restored, ${input.app.name}'s database does not answer.`,
        action: "Restore the project in the Supabase dashboard.",
        details: { status: read.project.value.status, plan },
        source: { label: "The project on Supabase", url: read.project.source.page, path: null, line: null },
        dedupeKey: `project_paused:${p.id}`,
        scope: `project_paused:${p.id}`,
      });
    }
  }

  if (read.migrations.ok && read.migrations.value.method !== "none") {
    checked.add(`migration_owed:${p.id}`);
    const check = read.migrations.value;
    const verifyPath = input.map?.migrations.verify?.path ?? "verify.sql";
    const missingTotal = check.owed.reduce((n, o) => n + o.missing.length, 0);
    for (const owed of check.owed) {
      const what = listWords(owed.missing);
      const marked = check.method === "markers" ? `, marked for it in ${verifyPath}, ${owed.missing.length === 1 ? "is" : "are"} not in the database (${plural(missingTotal, "marker", "markers")} of ${check.checked} missing in all)` : ` is not in the project's migration history`;
      drafts.push({
        kind: "migration_owed",
        severity: "warning",
        projectId: p.id,
        sentence: `The database of the Supabase project ${name} has not run ${owed.migration}: ${what}${marked}. Code that uses ${owed.missing.length === 1 ? "it" : "them"} fails until the file is run.`,
        action: owed.file ? `Run ${owed.file} in the Supabase SQL editor.` : "Run the migration in the Supabase SQL editor.",
        details: { migration: owed.migration, file: owed.file, missing: owed.missing, method: check.method },
        source: { label: "The Supabase SQL editor", url: read.migrations.source.page, path: owed.file, line: null },
        dedupeKey: `migration_owed:${p.id}:${owed.migration}`,
        scope: `migration_owed:${p.id}`,
      });
    }
  }
}

function oneSignalAlerts(drafts: AlertDraft[], checked: Set<string>, input: AlertInput, p: AlertProject, read: OneSignalRead, name: string): void {
  if (!read.audience.ok) return;
  checked.add(`plan_limit:${p.id}`);
  if (read.audience.value.mobileSuppressed === true) {
    const limits = LIMITS_BY_SLUG.get("onesignal");
    const free = limits ? tierFor(limits, "free") : null;
    const cap = free?.limits.find((l) => l.metric === "mobile_mau");
    drafts.push({
      kind: "plan_limit",
      severity: "critical",
      projectId: p.id,
      sentence: `OneSignal is dropping mobile push for ${name}: its estimate for a send to everyone says mobile recipients are suppressed, which OneSignal does when the organization is over its plan's cap${cap ? ` (on the Free plan, "${cap.source.quote.split(".")[0]}.")` : ""}. Mobile push and in-app messages do not send, while web push and email still do.`,
      action: "Upgrade the OneSignal organization, or bring mobile monthly active users under the cap.",
      details: { pushRecipients: read.audience.value.pushRecipients },
      source: { label: "The app on OneSignal", url: read.app.ok ? read.app.source.page : p.dashboardUrl, path: null, line: null },
      dedupeKey: `plan_limit:${p.id}:mobile_suppressed`,
      scope: `plan_limit:${p.id}`,
    });
  }
  void input;
}

function planOf(vendors: Vendor[], slug: string): string | null {
  const v = vendors.find((x) => x.slug === slug);
  return v ? (bestFacts(v.facts).find((f) => f.kind === "plan")?.value ?? null) : null;
}

/** Usage at 80% of the plan's limit or more, and crons more frequent than the Vercel plan allows. */
function planLimitAlerts(drafts: AlertDraft[], checked: Set<string>, input: AlertInput): void {
  for (const v of input.vendors) {
    const facts = bestFacts(v.facts);
    const plan = facts.find((f) => f.kind === "plan")?.value ?? input.projects.find((p) => p.vendor === v.slug && p.plan)?.plan ?? null;
    const limits = LIMITS_BY_SLUG.get(v.slug);
    const tier = limits && plan ? tierFor(limits, plan) : null;
    const usage = facts.filter((f) => f.kind === "usage" && f.numeric !== null && f.source === "connector");
    if (usage.length > 0) checked.add(`plan_limit:${v.slug}`);
    for (const f of usage) {
      const base = f.metric.split(":")[0]!;
      const checkedOne = f.limitNumeric === null ? checkedLimit(v.slug, plan, base) : null;
      const limit = f.limitNumeric ?? checkedOne?.amount ?? null;
      if (!limit || limit <= 0) continue;
      const ratio = f.numeric! / limit;
      if (ratio < 0.8) continue;
      const pct = Math.round(ratio * 100);
      const of = checkedOne ? `the ${limit.toLocaleString("en-US")} ${checkedOne.unit} the ${tier?.name ?? plan} plan includes` : `the account's limit of ${limit.toLocaleString("en-US")}${f.unit ? ` ${f.unit}` : ""}`;
      drafts.push({
        kind: "plan_limit",
        severity: ratio >= 0.95 ? "critical" : "warning",
        projectId: null,
        sentence: `${v.name} ${f.label.charAt(0).toLowerCase()}${f.label.slice(1)} is ${f.value}, ${pct}% of ${of}.${tier ? ` ${tier.endsWhen}` : ""}`,
        action: limits ? `Plan for ${limits.nextPrice.replace(/\.$/, "")}, or bring the usage down.` : null,
        details: { metric: f.metric, value: f.numeric, limit, plan },
        source: { label: checkedOne ? `${v.name}'s pricing page, checked ${limits!.verifiedOn}` : `${v.name} account`, url: checkedOne?.source.url ?? f.evidence?.url ?? null, path: null, line: null },
        dedupeKey: `plan_limit:${v.slug}:${f.metric}`,
        scope: `plan_limit:${v.slug}`,
      });
    }
  }

  // Crons that run more often than the Vercel plan allows fail the deployment.
  const map = input.map;
  const vercelPlan = planOf(input.vendors, "vercel");
  const vercelLimits = LIMITS_BY_SLUG.get("vercel");
  const vercelTier = vercelLimits && vercelPlan ? tierFor(vercelLimits, vercelPlan) : null;
  if (map && vercelTier) {
    checked.add("plan_limit:vercel");
    const cap = vercelTier.limits.find((l) => l.metric === "cron_runs_per_day");
    for (const c of map.crons) {
      if (!cap || c.perDay === null || c.perDay <= cap.amount) continue;
      drafts.push({
        kind: "plan_limit",
        severity: "critical",
        projectId: null,
        sentence: `The cron ${c.path} runs ${plural(c.perDay, "time", "times")} a day (${c.every}, ${c.source.path}:${c.source.line}), and Vercel's ${vercelTier.name} plan allows ${plural(cap.amount, "run", "runs")} a day: "${cap.source.quote}"`,
        action: "Run it once a day, or move the team to Pro.",
        details: { path: c.path, perDay: c.perDay, allowed: cap.amount },
        source: { label: `Vercel's cron limits, checked ${vercelLimits!.verifiedOn}`, url: cap.source.url, path: c.source.path, line: c.source.line },
        dedupeKey: `plan_limit:vercel:cron:${c.path}`,
        scope: "plan_limit:vercel",
      });
    }
  }
}

/** Dates the owner asked to be warned about, from 30 days before to 14 days after. */
interface FactRule {
  metric: string;
  kind: AppAlertKind;
  severity: "critical" | "warning";
  sentence: (f: VendorFact) => string;
  action: string;
}

/** What a connector read that needs a person, by vendor: the fact's metric, and the alert it makes while the fact is there with a count above zero. */
const FACT_RULES: Record<string, FactRule[]> = {
  github: [
    { metric: "ci_failed", kind: "ci_failed", severity: "warning", sentence: (f) => `${f.value}, so the default branch no longer passes its own checks.`, action: "Open the run and read the failing step. What is live is whatever the last passing run shipped." },
    { metric: "secrets_open", kind: "secret_alert", severity: "critical", sentence: (f) => `GitHub's secret scanning found ${f.numeric === 1 ? "a secret" : `${f.numeric} secrets`} in the repository and the ${f.numeric === 1 ? "alert is" : "alerts are"} open (${f.value}). A secret in the code is live until it is rotated.`, action: "Rotate each secret at its vendor first, then remove it from the code and resolve the alert." },
    { metric: "dependabot_serious", kind: "dependency_alert", severity: "warning", sentence: (f) => `Dependabot has ${f.numeric === 1 ? "an open alert" : `${f.numeric} open alerts`} of critical or high severity on the repository's dependencies (${f.value}).`, action: "Open the alerts and update or replace the packages. Each alert names the fixed version when one exists." },
    { metric: "code_scanning_serious", kind: "code_alert", severity: "warning", sentence: (f) => `Code scanning has ${f.numeric === 1 ? "an open alert" : `${f.numeric} open alerts`} of critical or high severity on the repository (${f.value}).`, action: "Open the alerts. Each one points at the file and line." },
  ],
  apple: [
    { metric: "version_rejected", kind: "store_rejected", severity: "warning", sentence: (f) => `App Review rejected a version of the app: ${f.value.replace(/\.?$/, "")}.`, action: "Open the version in App Store Connect and read App Review's message in Resolution Center, then fix and resubmit." },
    { metric: "build_failed", kind: "build_failed", severity: "warning", sentence: (f) => `The newest build uploaded to App Store Connect did not process: ${f.value}.`, action: "Upload a new build. Apple's email names the reason." },
  ],
};

/**
 * Alerts from what a connector read: a failed workflow run, security alerts
 * GitHub keeps, a version App Review rejected, a build that did not process.
 * A vendor nothing was read from this time changes nothing: what is open
 * stays until a read says otherwise.
 */
function factAlerts(drafts: AlertDraft[], checked: Set<string>, input: AlertInput): void {
  for (const v of input.vendors) {
    const rules = FACT_RULES[v.slug];
    if (!rules) continue;
    const facts = v.facts.filter((f) => f.source === "connector");
    if (facts.length === 0) continue;
    for (const rule of rules) {
      checked.add(`${rule.kind}:${v.id}`);
      // A vendor with several projects suffixes each project's metrics, so one alert per project.
      for (const f of facts.filter((x) => x.metric === rule.metric || x.metric.startsWith(`${rule.metric}:`))) {
        if ((f.numeric ?? 0) <= 0) continue;
        drafts.push({
          kind: rule.kind,
          severity: rule.severity,
          projectId: null,
          sentence: rule.sentence(f),
          action: rule.action,
          details: { vendor: v.slug, metric: f.metric, value: f.value, numeric: f.numeric },
          source: { label: `${v.name}: ${f.label}`, url: f.evidence?.url ?? null, path: null, line: null },
          dedupeKey: `${rule.kind}:${v.id}:${f.metric}`,
          scope: `${rule.kind}:${v.id}`,
        });
      }
    }
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function pathOf(url: string): string | null {
  try {
    return new URL(url).pathname.replace(/\/+$/, "") || "/";
  } catch {
    return null;
  }
}

function routePath(route: string): string {
  return route.replace(/\/+$/, "") || "/";
}

/** The app's hostnames as the Vercel reads know them: each project's production address and its domains. */
function appHosts(input: AlertInput): Set<string> {
  const hosts = new Set<string>();
  for (const read of input.reads.values()) {
    if (read.vendor !== "vercel") continue;
    if (read.project.ok && read.project.value.productionUrl) hosts.add(hostOf(read.project.value.productionUrl));
    if (read.domains.ok) for (const d of read.domains.value) hosts.add(d.name.toLowerCase());
  }
  hosts.delete("");
  return hosts;
}

/**
 * The code's Stripe webhook routes against the endpoints registered at
 * Stripe, when the Stripe key read them this time. A route no enabled
 * endpoint points at gets nothing from Stripe. An enabled endpoint pointing
 * at one of the app's hosts with no route behind it fails on every event.
 * The hosts come from the Vercel reads. Without one, paths alone are compared.
 */
function webhookAlerts(drafts: AlertDraft[], checked: Set<string>, input: AlertInput): void {
  const stripe = input.vendors.find((v) => v.slug === "stripe");
  const map = input.map;
  if (!stripe || !map) return;
  const read = stripe.facts.filter((f) => f.source === "connector");
  if (!read.some((f) => f.metric === "webhook_endpoints" || f.metric.startsWith("webhook_endpoints:"))) return;
  checked.add("webhook_unregistered:stripe");
  checked.add("webhook_unhandled:stripe");
  const hosts = appHosts(input);
  const routes = map.webhooks.filter((w) => w.service === "stripe");
  const registered = read
    .filter((f) => f.metric.startsWith("webhook_endpoint:"))
    .map((f) => ({ url: f.value, host: hostOf(f.value), path: pathOf(f.value), enabled: (f.numeric ?? 0) > 0 }));
  const dashboard = "https://dashboard.stripe.com/webhooks";
  for (const route of routes) {
    const path = routePath(route.route);
    const matches = registered.filter((e) => e.path === path && (hosts.size === 0 || hosts.has(e.host)));
    if (matches.some((e) => e.enabled)) continue;
    const disabled = matches.find((e) => !e.enabled);
    const where = hosts.size > 0 ? ` for ${[...hosts].slice(0, 3).join(", ")}` : "";
    const address = hosts.size > 0 ? `https://${[...hosts][0]}${route.route}` : `the app's address followed by ${route.route}`;
    drafts.push({
      kind: "webhook_unregistered",
      severity: "warning",
      projectId: null,
      sentence: disabled
        ? `The code handles Stripe webhooks at ${route.route} (${route.file}), and the endpoint Stripe has for it (${disabled.url}) is disabled, so Stripe sends it nothing.`
        : `The code handles Stripe webhooks at ${route.route} (${route.file}), but ${registered.length === 0 ? "no endpoint is registered at Stripe" : `none of the ${registered.length === 1 ? "endpoint" : `${registered.length} endpoints`} registered at Stripe${where} points there`}, so Stripe sends it nothing.`,
      action: disabled ? "Enable the endpoint in the Stripe dashboard, or remove it and the route together." : `Add an endpoint at Stripe for ${address}, with the events the handler reads, and set its signing secret in the project's environment.`,
      details: { route: route.route, file: route.file, endpoints: registered.map((e) => ({ url: e.url, enabled: e.enabled })), hosts: [...hosts] },
      source: { label: route.file, url: dashboard, path: route.file, line: null },
      dedupeKey: `webhook_unregistered:stripe:${route.route}`,
      scope: "webhook_unregistered:stripe",
    });
  }
  if (hosts.size === 0) return;
  for (const e of registered.filter((x) => x.enabled && hosts.has(x.host) && x.path !== null)) {
    // A route for another service at that path still receives the events: whether it checks the sender is the gap rule's question.
    if (map.webhooks.some((w) => routePath(w.route) === e.path)) continue;
    drafts.push({
      kind: "webhook_unhandled",
      severity: "warning",
      projectId: null,
      sentence: `Stripe sends events to ${e.url}, but the code has no webhook route at ${e.path}, so every delivery fails and Stripe keeps retrying it for days.`,
      action: "Point the endpoint at the route the code has, or disable it in the Stripe dashboard when the route is gone for good.",
      details: { url: e.url, path: e.path, routes: routes.map((r) => r.route) },
      source: { label: "Stripe webhook endpoint", url: dashboard, path: null, line: null },
      dedupeKey: `webhook_unhandled:stripe:${e.url}`,
      scope: "webhook_unhandled:stripe",
    });
  }
}

/** A short stable key for a list of words (FNV-1a), so an alert follows the same sentences across weekly checks. */
function keyOf(words: string[]): string {
  let hash = 0x811c9dc5;
  for (const ch of [...words].sort().join("\n")) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * A pricing page that no longer has a sentence the checked limits list rests
 * on, for a vendor this app uses. A page that could not be read changes
 * nothing: the notice stays as it was until the page is read again.
 */
function driftAlerts(drafts: AlertDraft[], checked: Set<string>, input: AlertInput): void {
  for (const d of input.drift ?? []) {
    if (!input.vendors.some((v) => v.slug === d.vendor)) continue;
    if (d.error) continue;
    checked.add(`limits_drift:${d.vendor}`);
    if (d.missing.length === 0) continue;
    const name = VENDOR_NAME[d.vendor] ?? input.vendors.find((v) => v.slug === d.vendor)?.name ?? d.vendor;
    drafts.push({
      kind: "limits_drift",
      severity: "notice",
      projectId: null,
      sentence: `The ${name} pricing page no longer has ${d.missing.length === 1 ? "the sentence" : `${d.missing.length} sentences`} the checked limits list rests on (${listWords(d.missing.map((m) => m.label))}), checked ${dateWords(d.checkedAt)}, so the list's ${name} limits may be out of date.`,
      action: `${d.proposal ? `What the page appears to say now, as the model read it: ${d.proposal} ` : ""}Re-read the page and update the checked limits list. This closes when the page matches the list again.`,
      details: { vendor: d.vendor, url: d.url, missing: d.missing, proposal: d.proposal, checkedAt: d.checkedAt },
      source: { label: `The ${name} pricing page`, url: d.url, path: null, line: null },
      dedupeKey: `limits_drift:${d.vendor}:${keyOf(d.missing.map((m) => m.label))}`,
      scope: `limits_drift:${d.vendor}`,
    });
  }
}

function deadlineAlerts(drafts: AlertDraft[], input: AlertInput): void {
  for (const d of input.deadlines) {
    const days = daysUntil(`${d.dueOn}T00:00:00Z`, input.now);
    if (days > 30 || days < -14) continue;
    drafts.push({
      kind: "deadline",
      severity: days <= 7 ? "critical" : "warning",
      projectId: null,
      sentence: `${d.label}${d.vendor ? ` (${VENDOR_NAME[d.vendor] ?? d.vendor})` : ""} ${days < 0 ? "was" : "is"} on ${dateWords(`${d.dueOn}T00:00:00Z`)}, ${inDays(days)}, as you noted on ${dateWords(d.createdAt)}.${d.note ? ` ${d.note.replace(/\.?$/, ".")}` : ""}`,
      action: days < 0 ? "Remove the date on the Projects page once it is handled." : null,
      details: { deadlineId: d.id, dueOn: d.dueOn },
      source: { label: "Dates to watch", url: null, path: null, line: null },
      dedupeKey: `deadline:app:${d.id}:${d.dueOn}`,
      scope: "deadline:app",
    });
  }
}

function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

/** Where the code reads an env name: its first read, or where the SDK that reads it is imported. */
function readLine(map: ServiceMap, e: MapEnv): { sdk: string | null; path: string; line: number } | null {
  const first = e.reads[0];
  if (first) return { sdk: null, path: first.path, line: first.line };
  const service = e.service ? map.services.find((s) => s.slug === e.service) : null;
  const imported = service?.imports[0];
  if (service && imported) return { sdk: service.name, path: imported.path, line: imported.line };
  return null;
}
