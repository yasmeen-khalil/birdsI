import { z } from "zod";
import { AlertEmailState, AppAlert } from "./alerts";
import { type AppProject } from "./apps";
import { Confidence, ScanScope, SEVERITY_ORDER, Severity, type Dependency, type Finding } from "./domain";
import { CATEGORY_ORDER, VENDOR_CATEGORY_LABEL, iconUrlFor } from "./icons";
import { LIMITS_BY_SLUG, checkedLimit, tierFor } from "./limits";
import { envNeededBy, missingEnv, roleForLabel, Found, MapPublicSurface, MapStoreApp, MapWebhook, ModelFind, ReaderStats, SourceLine, type StoredMap } from "./map";
import { bestFacts, FACT_SOURCE_LABEL, type Vendor } from "./ops";
import { AdvisorLint, OneSignalNotification, OwedMigration, VercelDeployment, VercelDomain, VercelLogLine, readsInDepth, type ProjectRead, type Reading } from "./reads";

/**
 * The cockpit of one app: its map and its live reads in one view, built the
 * same way for the web page, the terminal and agents. Everything is derived
 * from the service map, the app's projects, the newest read of each project,
 * the account facts and the alert stream, so an app with nothing written by
 * hand still renders from its map alone. A part that could not be read says
 * why, and is never a zero.
 */

/** A part of a card: its value, or why it is not there. */
function partOf<T extends z.ZodTypeAny>(value: T) {
  return z.discriminatedUnion("ok", [z.object({ ok: z.literal(true), value }), z.object({ ok: z.literal(false), reason: z.string() })]);
}

export const CardState = z.enum(["read", "not_read", "no_key", "no_reads"]);
export type CardState = z.infer<typeof CardState>;

const CardBase = z.object({
  projectId: z.string(),
  title: z.string(),
  label: z.string().nullable(),
  dashboardUrl: z.string().nullable(),
  state: CardState,
  /** Why the card has no read, when it has none. */
  reason: z.string().nullable(),
  readAt: z.string().nullable(),
});

export const EnvCheck = z.object({
  environment: z.string(),
  needed: z.number().int(),
  set: z.number().int(),
  missing: z.array(z.string()),
  optionalMissing: z.array(z.string()),
});
export type EnvCheck = z.infer<typeof EnvCheck>;

export const VercelCard = CardBase.extend({
  role: z.string().nullable(),
  productionUrl: z.string().nullable(),
  production: VercelDeployment.nullable(),
  live: VercelDeployment.nullable(),
  recent: z.array(VercelDeployment),
  deploymentsPart: partOf(z.number().int()),
  env: partOf(z.array(EnvCheck)),
  crons: partOf(z.object({ enabled: z.boolean(), expected: z.array(z.object({ path: z.string(), every: z.string(), registered: z.boolean() })), other: z.array(z.string()) })),
  domains: partOf(z.array(VercelDomain)),
  errors: partOf(z.array(VercelLogLine)),
  keyExpiry: partOf(z.string().nullable()),
});
export type VercelCard = z.infer<typeof VercelCard>;

export const SupabaseCard = CardBase.extend({
  status: z.string().nullable(),
  paused: z.boolean().nullable(),
  size: partOf(z.object({ mb: z.number(), limitMb: z.number().nullable(), plan: z.string().nullable() })),
  security: partOf(z.array(AdvisorLint)),
  performance: partOf(z.array(AdvisorLint)),
  migrations: partOf(z.object({ method: z.string(), how: z.string(), checked: z.number().int(), owed: z.array(OwedMigration) })),
});
export type SupabaseCard = z.infer<typeof SupabaseCard>;

export const OneSignalCard = CardBase.extend({
  app: partOf(z.object({ subscriptions: z.number().nullable(), subscribed: z.number().nullable(), platforms: z.array(z.string()) })),
  audience: partOf(z.object({ pushRecipients: z.number().nullable(), mobileSuppressed: z.boolean().nullable() })),
  notifications: partOf(z.object({ total: z.number().nullable(), recent: z.array(OneSignalNotification) })),
});
export type OneSignalCard = z.infer<typeof OneSignalCard>;

export const ServiceRow = z.object({
  slug: z.string(),
  name: z.string(),
  category: z.string(),
  how: z.array(z.string()),
  plan: z.string().nullable(),
  /** The app's projects at this vendor, and how many have a key. */
  projects: z.number().int(),
  keyed: z.number().int(),
  readsInDepth: z.boolean(),
  dashboardUrl: z.string().nullable(),
  pricingUrl: z.string().nullable(),
  checkedLimits: z.boolean(),
  firstSeen: SourceLine.nullable(),
  /** What the app uses it for, as the model read it. Judgment. */
  purpose: z.string().nullable(),
  found: Found.nullable(),
  categoryLabel: z.string(),
  /** The vendor's logo, when one is known. */
  icon: z.string().nullable(),
  /** Its documentation: the page, and whether the docs check read it and when. */
  docs: z.object({ url: z.string().nullable(), checkedAt: z.string().nullable(), status: z.string().nullable(), note: z.string().nullable(), packages: z.number().int() }),
});
export type ServiceRow = z.infer<typeof ServiceRow>;

/** Services grouped by what they are for. */
export const PurposeGroup = z.object({ category: z.string(), label: z.string(), services: z.array(ServiceRow) });
export type PurposeGroup = z.infer<typeof PurposeGroup>;

export const DependencySummary = z.object({
  total: z.number().int(),
  direct: z.number().int(),
  vulnerable: z.number().int(),
  /** Two or more major versions behind the latest release. */
  behind: z.number().int(),
  docsChecked: z.number().int(),
  docsCheckedAt: z.string().nullable(),
  /** Packages that work from the command line or a config file: the devtools. */
  devtools: z.array(z.string()),
});
export type DependencySummary = z.infer<typeof DependencySummary>;

export const FINDING_CATEGORY_LABEL: Record<string, string> = {
  security: "Security",
  gap: "Gaps",
  inconsistency: "Inconsistencies",
  contradiction: "Contradictions",
  redundancy: "Redundancies",
  stale: "Stale code and settings",
  dependency: "Dependencies",
  docs: "Against the documentation",
  config: "Repository settings",
};

export const SecuritySummary = z.object({
  total: z.number().int(),
  bySeverity: z.record(Severity, z.number().int()),
  byCategory: z.array(z.object({ category: z.string(), label: z.string(), count: z.number().int(), worst: Severity.nullable() })),
  /** The most serious open findings, five at most. */
  top: z.array(z.object({ id: z.string(), key: z.string(), title: z.string(), severity: Severity, confidence: Confidence, category: z.string(), path: z.string().nullable() })),
  scope: ScanScope.nullable(),
  finishedAt: z.string().nullable(),
});
export type SecuritySummary = z.infer<typeof SecuritySummary>;

export const MoneyLine = z.object({
  slug: z.string(),
  name: z.string(),
  /** read: money read from the account. list: a plan's list price from the checked limits list. manual: entered by the owner. */
  kind: z.enum(["read", "list", "manual"]),
  label: z.string(),
  monthlyUsd: z.number().nullable(),
  yearlyUsd: z.number().nullable(),
  source: z.string(),
  note: z.string().nullable(),
});
export type MoneyLine = z.infer<typeof MoneyLine>;

export const LimitLine = z.object({ slug: z.string(), name: z.string(), label: z.string(), used: z.number(), limit: z.number(), unit: z.string().nullable(), pct: z.number().int() });
export type LimitLine = z.infer<typeof LimitLine>;

export const MoneySummary = z.object({
  /** Money read from accounts this month, and the same every month for a year. Null when no account reports spend. */
  monthlyReadUsd: z.number().nullable(),
  yearlyReadUsd: z.number().nullable(),
  /** The list prices of the plans the accounts are on, from the checked limits list. Not money spent. */
  monthlyListUsd: z.number().nullable(),
  yearlyListUsd: z.number().nullable(),
  lines: z.array(MoneyLine),
  limits: z.array(LimitLine),
});
export type MoneySummary = z.infer<typeof MoneySummary>;

export const CronRow = z.object({
  path: z.string(),
  schedule: z.string(),
  every: z.string(),
  perDay: z.number().nullable(),
  source: SourceLine,
  handler: z.string().nullable(),
  checksSecret: z.boolean(),
  kind: z.string(),
  found: Found.nullable(),
  /** Per Vercel project of the app: registered there, or null when that project was not read. */
  projects: z.array(z.object({ title: z.string(), registered: z.boolean().nullable() })),
});
export type CronRow = z.infer<typeof CronRow>;

export const CockpitView = z.object({
  appName: z.string(),
  map: z.object({ mappedAt: z.string(), commit: z.string().nullable(), branch: z.string().nullable(), roles: z.array(z.string()), roleEnv: z.string().nullable(), files: z.number().int(), packages: z.number().int(), routes: z.number().int(), reader: ReaderStats.nullable(), scope: ScanScope.nullable() }).nullable(),
  /** The live address the app's own icon is fetched from, or null. */
  appIconBase: z.string().nullable(),
  mapReason: z.string().nullable(),
  readsReason: z.string().nullable(),
  lastReadAt: z.string().nullable(),
  alerts: z.object({ open: z.array(AppAlert), critical: z.number().int(), warning: z.number().int(), reason: z.string().nullable(), email: AlertEmailState }),
  vercel: z.array(VercelCard),
  supabase: z.array(SupabaseCard),
  onesignal: z.array(OneSignalCard),
  /** Vendors the code uses that birdsI reads in depth, with no project declared for them yet. */
  undeclared: z.array(z.object({ slug: z.string(), name: z.string() })),
  services: z.array(ServiceRow),
  purposeGroups: z.array(PurposeGroup),
  dependencies: DependencySummary.nullable(),
  security: SecuritySummary.nullable(),
  money: MoneySummary,
  /** Confirmed finds of the model with no part of the map to join: migration sources, second deployables, anything else. */
  alsoFound: z.array(ModelFind),
  crons: z.array(CronRow),
  webhooks: z.array(MapWebhook),
  storeApps: z.array(MapStoreApp),
  migrations: z.object({ style: z.string().nullable(), dir: z.string().nullable(), files: z.number().int(), latest: z.string().nullable(), verify: z.object({ path: z.string(), markers: z.number().int() }).nullable(), record: z.string().nullable() }).nullable(),
  publicSurface: MapPublicSurface.nullable(),
});
export type CockpitView = z.infer<typeof CockpitView>;

export const CockpitResponse = z.object({ cockpit: CockpitView });
export type CockpitResponse = z.infer<typeof CockpitResponse>;

export interface CockpitInput {
  appName: string;
  environments: string[];
  projects: AppProject[];
  map: StoredMap | null;
  mapReason: string | null;
  reads: Map<string, ProjectRead>;
  readsReason: string | null;
  alerts: AppAlert[];
  alertsReason: string | null;
  email: AlertEmailState;
  vendors: Vendor[];
  /** The newest finished map's packages, findings and scope, for the services' docs, the security section and the money section. */
  dependencies?: Dependency[];
  findings?: Finding[];
  scope?: ScanScope | null;
  scanFinishedAt?: string | null;
}

/** Packages that work from the command line, a config file or the framework: the devtools. */
const DEVTOOL = /^(@types\/|eslint|prettier|typescript$|vitest|jest|@vitest|tsx$|ts-node|esbuild|tailwindcss|postcss|autoprefixer|@tailwindcss|turbo$|husky|lint-staged|@playwright|playwright|cypress|storybook|@storybook|wrangler|nodemon|concurrently|dotenv|cross-env|rimraf|npm-run-all|@biomejs|biome|knip|@eslint|@typescript-eslint|eslint-|supabase$|vercel$)/;

function majorOf(version: string | null): number | null {
  const m = version?.match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

/** A plan's list price in dollars a month, from the words on the checked list ("$20 a month", "$99 a year"), or null when the words name no price. */
export function listPricePerMonth(price: string): number | null {
  const m = price.match(/\$([\d,]+(?:\.\d+)?)/);
  if (!m) return null;
  const amount = Number(m[1]!.replace(/,/g, ""));
  if (!Number.isFinite(amount)) return null;
  if (/year|annual/i.test(price)) return Math.round((amount / 12) * 100) / 100;
  return amount;
}

function part<T>(r: Reading<unknown> | undefined, value: () => T): { ok: true; value: T } | { ok: false; reason: string } {
  if (!r) return { ok: false, reason: "Not read yet." };
  return r.ok ? { ok: true, value: value() } : { ok: false, reason: r.reason };
}

function cardBase(p: AppProject, read: ProjectRead | undefined, readsReason: string | null): z.infer<typeof CardBase> {
  const state: CardState = read ? "read" : readsReason ? "no_reads" : !p.key ? "no_key" : "not_read";
  const reason = read
    ? null
    : readsReason ?? (!p.key ? "No key yet. Add one on the Projects page and birdsI reads this project within the hour." : p.key.lastStatus === "failed" && p.key.lastError ? p.key.lastError : "Not read yet. The worker reads it within the hour, or now with Read accounts.");
  return { projectId: p.id, title: p.label && p.label !== p.ref ? `${p.ref} (${p.label})` : p.ref, label: p.label, dashboardUrl: p.dashboardUrl || null, state, reason, readAt: read?.readAt ?? null };
}

const VENDOR_NAMES: Record<string, string> = { vercel: "Vercel", supabase: "Supabase", onesignal: "OneSignal" };

/** The whole cockpit of one app, from what is stored. Pure. */
export function cockpitView(input: CockpitInput): CockpitView {
  const map = input.map?.map ?? null;
  const vendorPlan = (slug: string) => {
    const v = input.vendors.find((x) => x.slug === slug);
    return (v ? bestFacts(v.facts).find((f) => f.kind === "plan")?.value : null) ?? input.projects.find((p) => p.vendor === slug && p.plan)?.plan ?? null;
  };
  const environments = input.environments.length > 0 ? input.environments : ["production"];

  const vercel: VercelCard[] = input.projects
    .filter((p) => p.vendor === "vercel" && p.kind === "project")
    .map((p) => {
      const read = input.reads.get(p.id);
      const base = cardBase(p, read, input.readsReason);
      const data = read?.data.vendor === "vercel" ? read.data : null;
      const role = map ? roleForLabel(p.label, map.roles) : null;
      const deployments = data?.deployments.ok ? data.deployments.value : [];
      const production = deployments.filter((d) => d.target === "production").sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      if (data?.project.ok) base.title = p.label && p.label !== data.project.value.name ? `${data.project.value.name} (${p.label})` : data.project.value.name;
      const root = data?.project.ok ? data.project.value.rootDirectory : null;
      const crons = (map?.crons ?? []).filter((c) => root === null || dirOf(c.source.path) === root);
      return {
        ...base,
        role,
        productionUrl: data?.project.ok ? data.project.value.productionUrl : null,
        production: production[0] ?? null,
        live: production.find((d) => d.state === "READY") ?? null,
        recent: deployments.slice(0, 5),
        deploymentsPart: part(data?.deployments, () => deployments.length),
        env: !map
          ? { ok: false as const, reason: input.mapReason ?? "No service map yet, so the env names the code needs are not known." }
          : part(data?.env, () => {
              const needed = envNeededBy(map, role);
              const required = needed.required.filter((e) => e.areas.some((a) => a !== "declared"));
              return environments.map((environment) => {
                const present = new Set((data!.env.ok ? data!.env.value : []).filter((e) => e.targets.includes(environment)).map((e) => e.key));
                const missing = missingEnv(required, present).map((e) => e.name);
                return { environment, needed: required.length, set: required.length - missing.length, missing, optionalMissing: missingEnv(needed.optional, present).map((e) => e.name) };
              });
            }),
        crons: part(data?.crons, () => {
          const registered = data!.crons.ok ? data!.crons.value : null;
          const paths = new Set((registered?.definitions ?? []).map((d) => d.path.split("?")[0]!));
          return {
            enabled: registered ? registered.enabled : true,
            expected: crons.map((c) => ({ path: c.path, every: c.every, registered: paths.has(c.path.split("?")[0]!) })),
            other: [...paths].filter((x) => !crons.some((c) => c.path.split("?")[0] === x)),
          };
        }),
        domains: part(data?.domains, () => (data!.domains.ok ? data!.domains.value : [])),
        errors: part(data?.errors, () => (data!.errors.ok ? data!.errors.value : [])),
        keyExpiry: part(data?.keyExpiry, () => (data!.keyExpiry.ok ? data!.keyExpiry.value.expiresAt : null)),
      };
    });

  const supabase: SupabaseCard[] = input.projects
    .filter((p) => p.vendor === "supabase" && p.kind === "project")
    .map((p) => {
      const read = input.reads.get(p.id);
      const base = cardBase(p, read, input.readsReason);
      const data = read?.data.vendor === "supabase" ? read.data : null;
      if (data?.project.ok) base.title = data.project.value.name;
      const plan = vendorPlan("supabase");
      return {
        ...base,
        status: data?.project.ok ? data.project.value.status : null,
        paused: data?.project.ok ? data.project.value.paused : null,
        size: part(data?.size, () => {
          const mb = Math.round(((data!.size.ok ? data!.size.value.bytes : 0) / 1_048_576) * 10) / 10;
          return { mb, limitMb: checkedLimit("supabase", plan, "db_size_mb")?.amount ?? null, plan };
        }),
        security: part(data?.security, () => (data!.security.ok ? data!.security.value : [])),
        performance: part(data?.performance, () => (data!.performance.ok ? data!.performance.value : [])),
        migrations: part(data?.migrations, () => {
          const m = data!.migrations.ok ? data!.migrations.value : { method: "none", how: "", checked: 0, owed: [] };
          return { method: m.method, how: m.how, checked: m.checked, owed: m.owed };
        }),
      };
    });

  const onesignal: OneSignalCard[] = input.projects
    .filter((p) => p.vendor === "onesignal" && p.kind === "app")
    .map((p) => {
      const read = input.reads.get(p.id);
      const base = cardBase(p, read, input.readsReason);
      const data = read?.data.vendor === "onesignal" ? read.data : null;
      if (data?.app.ok) base.title = data.app.value.name;
      return {
        ...base,
        app: part(data?.app, () => (data!.app.ok ? { subscriptions: data!.app.value.subscriptions, subscribed: data!.app.value.subscribed, platforms: data!.app.value.platforms } : { subscriptions: null, subscribed: null, platforms: [] })),
        audience: part(data?.audience, () => (data!.audience.ok ? data!.audience.value : { pushRecipients: null, mobileSuppressed: null })),
        notifications: part(data?.notifications, () => (data!.notifications.ok ? data!.notifications.value : { total: null, recent: [] })),
      };
    });

  const declared = new Set(input.projects.map((p) => p.vendor));
  const dependencies = input.dependencies ?? [];
  const services: ServiceRow[] = (map?.services ?? []).map((s) => {
    const projects = input.projects.filter((p) => p.vendor === s.slug);
    const vendor = input.vendors.find((v) => v.slug === s.slug);
    const checked = dependencies.filter((d) => s.packages.includes(d.name) && d.docsCheck).sort((a, b) => (b.docsCheck!.checkedAt ?? "").localeCompare(a.docsCheck!.checkedAt ?? ""));
    const newest = checked[0]?.docsCheck ?? null;
    return {
      slug: s.slug,
      name: s.name,
      category: s.category,
      how: s.how,
      plan: vendorPlan(s.slug),
      projects: projects.length,
      keyed: projects.filter((p) => p.key).length,
      readsInDepth: Boolean(VENDOR_NAMES[s.slug]) || projects.some((p) => readsInDepth(p.vendor, p.kind)),
      dashboardUrl: s.dashboardUrl,
      pricingUrl: s.pricingUrl,
      checkedLimits: s.checkedLimits,
      firstSeen: s.imports[0] ?? s.sources[0] ?? null,
      purpose: s.purpose,
      found: s.found,
      categoryLabel: VENDOR_CATEGORY_LABEL[s.category as keyof typeof VENDOR_CATEGORY_LABEL] ?? s.category,
      icon: iconUrlFor(s.slug),
      docs: { url: newest?.doc?.url ?? vendor?.docsUrl ?? null, checkedAt: newest?.checkedAt ?? null, status: newest?.status ?? null, note: newest?.note ?? null, packages: checked.length },
    };
  });
  const purposeGroups: PurposeGroup[] = CATEGORY_ORDER.map((category) => ({ category, label: VENDOR_CATEGORY_LABEL[category], services: services.filter((s) => s.category === category) })).filter((g) => g.services.length > 0);

  const dependencySummary: DependencySummary | null =
    input.dependencies === undefined
      ? null
      : {
          total: dependencies.length,
          direct: dependencies.filter((d) => d.direct).length,
          vulnerable: dependencies.filter((d) => d.vulnerabilities.length > 0).length,
          behind: dependencies.filter((d) => {
            const used = majorOf(d.versionInUse);
            const latest = majorOf(d.latestVersion);
            return used !== null && latest !== null && latest - used >= 2;
          }).length,
          docsChecked: dependencies.filter((d) => d.docsCheck && d.docsCheck.status !== "unknown").length,
          docsCheckedAt: dependencies.map((d) => d.docsCheck?.checkedAt ?? "").sort().at(-1) || null,
          devtools: dependencies.filter((d) => d.direct && DEVTOOL.test(d.name)).map((d) => d.name).sort(),
        };

  const openFindings = (input.findings ?? []).filter((f) => f.status !== "dismissed" && f.status !== "fixed");
  const rank = (f: Finding) => SEVERITY_ORDER.indexOf(f.severity);
  const security: SecuritySummary | null =
    input.findings === undefined
      ? null
      : {
          total: openFindings.length,
          bySeverity: Object.fromEntries(SEVERITY_ORDER.map((sev) => [sev, openFindings.filter((f) => f.severity === sev).length])) as Record<Severity, number>,
          byCategory: Object.keys(FINDING_CATEGORY_LABEL)
            .map((category) => {
              const list = openFindings.filter((f) => f.category === category);
              return { category, label: FINDING_CATEGORY_LABEL[category]!, count: list.length, worst: list.length > 0 ? [...list].sort((a, b) => rank(a) - rank(b))[0]!.severity : null };
            })
            .filter((c) => c.count > 0),
          top: [...openFindings]
            .sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title))
            .slice(0, 5)
            .map((f) => ({ id: f.id, key: f.key, title: f.title, severity: f.severity, confidence: f.confidence, category: f.category, path: f.location?.path ?? null })),
          scope: input.scope ?? null,
          finishedAt: input.scanFinishedAt ?? null,
        };

  const moneyLines: MoneyLine[] = [];
  const limitLines: LimitLine[] = [];
  for (const v of input.vendors) {
    const facts = bestFacts(v.facts);
    const spend = facts.find((f) => f.kind === "cost" && f.metric === "spend_month" && f.numeric !== null && f.source === "connector");
    if (spend) moneyLines.push({ slug: v.slug, name: v.name, kind: "read", label: spend.label, monthlyUsd: spend.numeric, yearlyUsd: Math.round(spend.numeric! * 12 * 100) / 100, source: "Read from the account this month", note: "A year at this month's rate." });
    const plan = facts.find((f) => f.kind === "plan");
    const limits = LIMITS_BY_SLUG.get(v.slug);
    const tier = plan && limits ? tierFor(limits, plan.value) : null;
    if (plan && tier) {
      const monthly = listPricePerMonth(tier.price);
      moneyLines.push({ slug: v.slug, name: v.name, kind: "list", label: `${tier.name} plan`, monthlyUsd: monthly, yearlyUsd: monthly === null ? null : Math.round(monthly * 12 * 100) / 100, source: `${FACT_SOURCE_LABEL[plan.source]}. List price from the checked limits list, read ${limits!.verifiedOn}.`, note: monthly === null ? tier.price : "A list price, not money spent." });
    }
    for (const f of facts) {
      if (f.kind !== "usage" || f.numeric === null) continue;
      const limit = f.limitNumeric ?? checkedLimit(v.slug, plan?.value ?? null, f.metric)?.amount ?? null;
      if (limit === null || limit <= 0) continue;
      limitLines.push({ slug: v.slug, name: v.name, label: f.label, used: f.numeric, limit, unit: f.unit, pct: Math.min(999, Math.round((f.numeric / limit) * 100)) });
    }
  }
  const sum = (kind: MoneyLine["kind"], field: "monthlyUsd" | "yearlyUsd") => {
    const list = moneyLines.filter((l) => l.kind === kind && l[field] !== null);
    return list.length > 0 ? Math.round(list.reduce((a, l) => a + l[field]!, 0) * 100) / 100 : null;
  };
  const money: MoneySummary = {
    monthlyReadUsd: sum("read", "monthlyUsd"),
    yearlyReadUsd: sum("read", "yearlyUsd"),
    monthlyListUsd: sum("list", "monthlyUsd"),
    yearlyListUsd: sum("list", "yearlyUsd"),
    lines: moneyLines.sort((a, b) => a.name.localeCompare(b.name) || a.kind.localeCompare(b.kind)),
    limits: limitLines.sort((a, b) => b.pct - a.pct),
  };
  const undeclared = (map?.services ?? []).filter((s) => VENDOR_NAMES[s.slug] && !declared.has(s.slug)).map((s) => ({ slug: s.slug, name: s.name }));

  const crons: CronRow[] = (map?.crons ?? []).map((c) => ({
    path: c.path,
    schedule: c.schedule,
    every: c.every,
    perDay: c.perDay,
    source: c.source,
    handler: c.handler,
    checksSecret: c.checksSecret,
    kind: c.kind,
    found: c.found,
    projects: vercel
      .filter((v) => v.crons.ok ? v.crons.value.expected.some((e) => e.path === c.path) : true)
      .map((v) => ({ title: v.title, registered: v.crons.ok ? (v.crons.value.expected.find((e) => e.path === c.path)?.registered ?? false) : null })),
  }));

  const open = input.alerts.filter((a) => !a.resolvedAt);
  const lastReadAt = [...input.reads.values()].map((r) => r.readAt).sort().at(-1) ?? null;
  const migrations = map
    ? {
        style: map.migrations.style,
        dir: map.migrations.dir,
        files: map.migrations.files.length,
        latest: map.migrations.files.at(-1)?.name ?? null,
        verify: map.migrations.verify ? { path: map.migrations.verify.path, markers: map.migrations.verify.markers.length } : null,
        record: map.migrations.record?.table ?? null,
      }
    : null;

  return {
    appName: input.appName,
    map: map && input.map ? { mappedAt: input.map.createdAt, commit: map.commit, branch: map.branch, roles: map.roles.names, roleEnv: map.roles.envName, files: map.counts.files, packages: map.counts.packages, routes: map.counts.routes, reader: map.reader, scope: input.scope ?? null } : null,
    appIconBase: vercel.find((c) => c.productionUrl)?.productionUrl ?? map?.storeApps.find((a) => a.webUrl)?.webUrl ?? null,
    mapReason: input.mapReason,
    readsReason: input.readsReason,
    lastReadAt,
    alerts: { open, critical: open.filter((a) => a.severity === "critical").length, warning: open.filter((a) => a.severity === "warning").length, reason: input.alertsReason, email: input.email },
    vercel,
    supabase,
    onesignal,
    undeclared,
    services,
    purposeGroups,
    dependencies: dependencySummary,
    security,
    money,
    alsoFound: map?.modelFinds.filter((f) => !f.merged) ?? [],
    crons,
    webhooks: map?.webhooks ?? [],
    storeApps: map?.storeApps ?? [],
    migrations,
    publicSurface: map?.publicSurface ?? null,
  };
}

/** The plan's limit of a checked metric, with the page it came from, for a card's caption. */
export function planCaption(slug: string, plan: string | null): string | null {
  const limits = LIMITS_BY_SLUG.get(slug);
  const tier = limits && plan ? tierFor(limits, plan) : null;
  return tier ? `${tier.name} plan, checked ${limits!.verifiedOn}` : null;
}

function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}
