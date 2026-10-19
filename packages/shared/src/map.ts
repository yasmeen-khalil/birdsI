import { z } from "zod";

/**
 * The service map: what one app is made of, read from its code by rules, no
 * model. Every entry keeps the file and line it came from. It never holds a
 * value: env entries are names only, and lines that look like keys are masked.
 */

export const SourceLine = z.object({
  path: z.string(),
  line: z.number().int().positive(),
  /** The line itself, trimmed and masked, at most 200 characters. */
  text: z.string(),
});
export type SourceLine = z.infer<typeof SourceLine>;

/** A deployable folder: a package.json with a framework, and where its routes live. */
export const MapUnit = z.object({
  path: z.string(),
  name: z.string().nullable(),
  framework: z.string().nullable(),
});
export type MapUnit = z.infer<typeof MapUnit>;

export const MapService = z.object({
  slug: z.string(),
  name: z.string(),
  category: z.string(),
  /** How the map knows the app uses it. */
  how: z.array(z.enum(["package", "import", "env", "url", "config", "projects"])),
  packages: z.array(z.string()),
  /** Where the code imports the vendor's SDK. */
  imports: z.array(SourceLine),
  envNames: z.array(z.string()),
  /** Other places it shows: env reads, addresses, config files. */
  sources: z.array(SourceLine),
  dashboardUrl: z.string().nullable(),
  pricingUrl: z.string().nullable(),
  /** True when birdsI's checked limits list has this vendor. */
  checkedLimits: z.boolean(),
});
export type MapService = z.infer<typeof MapService>;

/**
 * Where code that reads an env name runs: "shared" code is reached from
 * routes of every deployment, "cron" and "webhook" from those routes (they run
 * on the product deployment), a role name from routes only that deployment
 * serves, "declared" when only the example env file names it (read by a
 * framework or a build step), "unreached" from no route at all (scripts).
 */
export const EnvArea = z.string();

export const MapEnv = z.object({
  name: z.string(),
  /** Names the code reads in its place when it is unset ("A || B"): either one is enough. */
  alternatives: z.array(z.string()).default([]),
  /** Shipped to the browser (NEXT_PUBLIC_, VITE_, EXPO_PUBLIC_, PUBLIC_). */
  public: z.boolean(),
  /** The vendor it belongs to, when the catalog knows the name. */
  service: z.string().nullable(),
  /** Its line in the example env file, when there is one. */
  declared: SourceLine.nullable(),
  /** The comment above it in the example env file. */
  note: z.string().nullable(),
  /** Optional, and why: the example file says so, or every read has a fallback. */
  optional: z.boolean(),
  optionalWhy: z.string().nullable(),
  areas: z.array(EnvArea),
  /** The deployment roles whose routes reach a read of it. Empty when the app has no roles. */
  roles: z.array(z.string()),
  reads: z.array(SourceLine),
});
export type MapEnv = z.infer<typeof MapEnv>;

/** How one codebase becomes several deployments: an env name compared with role names. */
export const MapRoles = z.object({
  envName: z.string().nullable(),
  /** The role the code falls back to when the env name is unset: the product. */
  defaultRole: z.string().nullable(),
  names: z.array(z.string()),
  sources: z.array(SourceLine),
});
export type MapRoles = z.infer<typeof MapRoles>;

export const MapCron = z.object({
  path: z.string(),
  schedule: z.string(),
  /** The schedule in words: "every day at 04:00 UTC". */
  every: z.string(),
  /** Runs a day, when the schedule says it plainly; null when it does not. */
  perDay: z.number().nullable(),
  source: SourceLine,
  /** The route file that handles it, or null when none was found. */
  handler: z.string().nullable(),
  /** Whether the handler checks the CRON_SECRET bearer Vercel sends. */
  checksSecret: z.boolean(),
});
export type MapCron = z.infer<typeof MapCron>;

export const MapWebhook = z.object({
  route: z.string(),
  file: z.string(),
  service: z.string().nullable(),
  /** The line that checks the sender: a signature, a shared secret. Null when none was found. */
  verifies: SourceLine.nullable(),
  methods: z.array(z.string()),
});
export type MapWebhook = z.infer<typeof MapWebhook>;

export const MapStoreApp = z.object({
  platform: z.enum(["ios", "android", "capacitor", "expo"]),
  bundleId: z.string().nullable(),
  appName: z.string().nullable(),
  /** The site a Capacitor shell loads, when it loads a live site. */
  webUrl: z.string().nullable(),
  source: SourceLine,
});
export type MapStoreApp = z.infer<typeof MapStoreApp>;

export const MigrationMarker = z.object({
  migration: z.string(),
  kind: z.string(),
  name: z.string(),
  col: z.string().nullable(),
});
export type MigrationMarker = z.infer<typeof MigrationMarker>;

export const MapMigrations = z.object({
  /** supabase-cli: supabase/migrations/<timestamp>_name.sql. numbered: 0001_name.sql. versioned: supabase-v12.sql. */
  style: z.enum(["supabase-cli", "numbered", "versioned"]).nullable(),
  dir: z.string().nullable(),
  files: z.array(z.object({ name: z.string(), path: z.string() })),
  /** The read-only query that says which migrations ran, and its markers. */
  verify: z.object({ path: z.string(), markers: z.array(MigrationMarker) }).nullable(),
  /** A table the migrations write their own version into, when they keep one. */
  record: z.object({ table: z.string(), source: SourceLine }).nullable(),
});
export type MapMigrations = z.infer<typeof MapMigrations>;

export const MapPublicSurface = z.object({
  sitemap: SourceLine.nullable(),
  robots: SourceLine.nullable(),
  llmsTxt: SourceLine.nullable(),
});
export type MapPublicSurface = z.infer<typeof MapPublicSurface>;

export const ServiceMap = z.object({
  version: z.literal(1),
  readAt: z.string(),
  commit: z.string().nullable(),
  branch: z.string().nullable(),
  units: z.array(MapUnit),
  services: z.array(MapService),
  env: z.array(MapEnv),
  roles: MapRoles,
  crons: z.array(MapCron),
  webhooks: z.array(MapWebhook),
  storeApps: z.array(MapStoreApp),
  migrations: MapMigrations,
  publicSurface: MapPublicSurface,
  counts: z.object({ files: z.number().int(), packages: z.number().int(), routes: z.number().int() }),
});
export type ServiceMap = z.infer<typeof ServiceMap>;

/** A map as it is stored: dated, with the map of the code it came from. */
export const StoredMap = z.object({
  appId: z.string().nullable(),
  repoId: z.string(),
  scanId: z.string().nullable(),
  createdAt: z.string(),
  map: ServiceMap,
});
export type StoredMap = z.infer<typeof StoredMap>;

export const MapHistoryEntry = z.object({
  id: z.string(),
  createdAt: z.string(),
  commit: z.string().nullable(),
  branch: z.string().nullable(),
  scanId: z.string().nullable(),
});
export type MapHistoryEntry = z.infer<typeof MapHistoryEntry>;

/** GET /api/v1/repos/:repoId/map: the newest map, the dates of the ones before it, and why there is none when there is none. */
export const MapResponse = z.object({
  map: StoredMap.nullable(),
  history: z.array(MapHistoryEntry),
  reason: z.string().nullable(),
});
export type MapResponse = z.infer<typeof MapResponse>;

/**
 * The env names one deployment role needs, by the map's rules. The product
 * (the default role) needs every name its routes reach; another role needs the
 * names only its own routes reach, plus the role name itself, and the names of
 * shared code are listed apart, since whether that deployment uses them is the
 * app's choice. The role name is never needed by the product: unset means it.
 */
export function envNeededBy(map: Pick<ServiceMap, "env" | "roles">, role: string | null): { required: MapEnv[]; optional: MapEnv[]; shared: MapEnv[] } {
  const reached = map.env.filter((e) => !e.areas.every((a) => a === "unreached"));
  const product = map.roles.defaultRole;
  const isProduct = role === null || role === product || map.roles.names.length === 0;
  const own = reached.filter((e) => {
    if (e.name === map.roles.envName) return !isProduct;
    if (map.roles.names.length === 0 || isProduct) return e.areas.some((a) => a === "shared" || a === "cron" || a === "webhook" || a === "declared" || a === product);
    return e.areas.includes(role!);
  });
  // A deployment other than the product also runs the shared code, but whether it needs those names is the app's choice.
  const shared = isProduct ? [] : reached.filter((e) => !own.includes(e) && e.areas.includes("shared"));
  return { required: own.filter((e) => !e.optional), optional: own.filter((e) => e.optional), shared };
}

/** Names a deployment needs but does not have, an alternative name counting as present. */
export function missingEnv(needed: MapEnv[], present: ReadonlySet<string>): MapEnv[] {
  return needed.filter((e) => !present.has(e.name) && !e.alternatives.some((a) => present.has(a)));
}

/**
 * The deployment a vendor project serves, from the owner's label for it: a
 * label that names a role (any case, singular or plural, or as one word of
 * the label, such as "flowsophy-ops") selects that role, and any other label,
 * or none, is the default role, the deployment when the role variable is unset.
 */
export function roleForLabel(label: string | null, roles: Pick<MapRoles, "names" | "defaultRole">): string | null {
  if (!label || roles.names.length === 0) return roles.defaultRole;
  const one = (w: string) => w.toLowerCase().replace(/s$/, "");
  const word = one(label.trim());
  const exact = roles.names.find((n) => one(n) === word);
  if (exact) return exact;
  const words = new Set(label.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(one));
  const named = roles.names.filter((n) => n !== roles.defaultRole && words.has(one(n)));
  return named.length === 1 ? named[0]! : roles.defaultRole;
}

/** The map's totals in one line, for the run's progress on every surface. */
export function mapCountsLine(c: { services: number; envNames: number; crons: number; webhooks: number; storeApps: number; migrations: number; roles: string[] }): string {
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  const line = [
    n(c.services, "service", "services"),
    n(c.envNames, "env name", "env names"),
    n(c.crons, "cron", "crons"),
    n(c.webhooks, "webhook", "webhooks"),
    n(c.storeApps, "store app", "store apps"),
    n(c.migrations, "migration file", "migration files"),
  ].join(", ");
  return c.roles.length > 1 ? `${line}. Deployments: ${c.roles.join(", ")}` : line;
}
