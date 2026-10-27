import { LIMITS_BY_SLUG, type Found, type MapCron, type MapEnv, type MapRoles, type MapService, type MapStoreApp, type MapWebhook, type ServiceMap, type SourceLine } from "@birdsi/shared";
import { maskSecrets } from "../checks/secrets";
import { areasByFile, PUBLIC_PREFIX, rolesForAreas } from "../map/env";
import type { MapContext } from "../map/index";
import { describeSchedule, methodsIn, verifyLineIn, webhookService } from "../map/parts";
import { CATALOG, type CatalogEntry } from "../vendors/catalog";
import { cleanSlug, matchDomain, matchEnv, matchPackage } from "../vendors/discover";
import type { Find } from "./schema";

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const flat = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);

/**
 * The find's line, when the file has it and the line says what the find
 * claims: the quoted text is on that line, and the thing named is on it too
 * (an env name as a whole token, a schedule as written, a service by name).
 */
export function confirmFind(find: Find, content: string | null): SourceLine | null {
  if (!content) return null;
  const raw = content.split("\n")[find.line - 1];
  if (raw === undefined) return null;
  const line = norm(raw);
  const masked = norm(maskSecrets(raw));
  const quote = norm(find.quote);
  if (quote.length < 2 || !(line.includes(quote) || masked.includes(quote))) return null;
  if (!mentions(line, find)) return null;
  return { path: find.path, line: find.line, text: maskSecrets(raw.trim()).slice(0, 200) };
}

function mentions(line: string, find: Find): boolean {
  if (find.kind === "env") return new RegExp(`(^|[^A-Za-z0-9_])${find.name}([^A-Za-z0-9_]|$)`).test(line);
  if (find.kind === "other") return true;
  if (find.kind === "cron" && find.schedule && line.includes(find.schedule)) return true;
  const inLine = flat(line);
  const name = flat(find.name);
  if (name.length >= 3 && inLine.includes(name)) return true;
  const lower = line.toLowerCase();
  if (words(find.name).some((w) => lower.includes(w))) return true;
  // A route, a config or a deployable is named by its file as often as by a line in it.
  if (find.kind === "webhook" || find.kind === "store_app" || find.kind === "migration" || find.kind === "deployment") {
    const path = find.path.toLowerCase();
    return words(find.name).some((w) => path.includes(w)) || (find.kind === "webhook" && path.includes("webhook"));
  }
  return false;
}

function packageOf(spec: string): string | null {
  if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("node:")) return null;
  const parts = spec.split("/");
  return spec.startsWith("@") ? (parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null) : parts[0]!;
}

/** The catalog vendor a find is about, by its name, or by a package, env name or domain on its line. */
export function catalogFor(find: Find, line: string): CatalogEntry | null {
  const name = flat(find.name);
  const byName = CATALOG.find((e) => flat(e.name) === name || flat(e.slug) === name);
  if (byName) return byName;
  for (const m of line.matchAll(/["'`]([^"'`\s]+)["'`]/g)) {
    const pkg = packageOf(m[1]!);
    const entry = pkg ? matchPackage(pkg) : null;
    if (entry) return entry;
  }
  for (const m of line.matchAll(/\b([A-Z][A-Z0-9_]{2,})\b/g)) {
    const entry = matchEnv(m[1]!);
    if (entry) return entry;
  }
  for (const m of line.matchAll(/https?:\/\/([a-z0-9][a-z0-9.-]+\.[a-z]{2,})/gi)) {
    const entry = matchDomain(m[1]!);
    if (entry) return entry;
  }
  return null;
}

const normRoute = (r: string) => `/${r.replace(/^\/+|\/+$/g, "")}`;

/** True when the map already has what the find names. */
export function alreadyKnown(map: ServiceMap, find: Find, at: SourceLine): boolean {
  switch (find.kind) {
    case "service": {
      const entry = catalogFor(find, at.text);
      if (entry && map.services.some((s) => s.slug === entry.slug)) return true;
      const name = flat(find.name);
      return map.services.some((s) => flat(s.name) === name || flat(s.slug) === name);
    }
    case "env":
      return map.env.some((e) => e.name === find.name || e.alternatives.includes(find.name));
    case "cron":
      return map.crons.some((c) => (c.source.path === at.path && c.source.line === at.line) || (find.schedule !== null && c.schedule === find.schedule && (c.path === find.name || c.source.path === at.path)));
    case "webhook":
      return map.webhooks.some((w) => w.file === at.path || normRoute(w.route) === normRoute(find.name));
    case "store_app":
      return map.storeApps.some((a) => a.bundleId === find.name || a.source.path === at.path);
    default:
      return map.modelFinds.some((f) => f.kind === find.kind && f.at.path === at.path && f.at.line === at.line);
  }
}

export interface MergeContext {
  map: ServiceMap;
  context: MapContext;
  model: string;
  /** Lazily computed: which areas each file runs in. */
  areas: Map<string, Set<string>> | null;
}

function areasOf(ctx: MergeContext, roles: MapRoles): Map<string, Set<string>> {
  if (!ctx.areas) ctx.areas = areasByFile(ctx.context.graph, roles);
  return ctx.areas;
}

function storePlatform(path: string): MapStoreApp["platform"] | null {
  if (/(^|\/)capacitor\.config\.(ts|js|json)$/.test(path)) return "capacitor";
  if (/(^|\/)(app\.json|app\.config\.(ts|js))$/.test(path)) return "expo";
  if (/\.pbxproj$|\.plist$|\.xcconfig$/.test(path)) return "ios";
  if (/build\.gradle(\.kts)?$|AndroidManifest\.xml$/.test(path)) return "android";
  return null;
}

function cronKind(at: SourceLine): MapCron["kind"] {
  if (/(^|\/)\.github\/workflows\//.test(at.path)) return "actions";
  if (/cron\.schedule|pg_cron/i.test(at.text) || at.path.endsWith(".sql")) return "pg_cron";
  if (/(^|\/)vercel\.json$/.test(at.path)) return "vercel";
  return "code";
}

/**
 * Puts a confirmed find into the part of the map it belongs to. Returns
 * false when the kind has no part to join (a migration source, a second
 * deployable, anything else): the find is then listed on its own.
 */
export async function mergeFind(ctx: MergeContext, find: Find, at: SourceLine): Promise<boolean> {
  const { map } = ctx;
  const found: Found = { by: "model", model: ctx.model, at };
  switch (find.kind) {
    case "service": {
      const entry = catalogFor(find, at.text);
      const slug = entry?.slug ?? cleanSlug(find.name);
      if (!slug || map.services.some((s) => s.slug === slug)) return false;
      const service: MapService = {
        slug,
        name: entry?.name ?? find.name.slice(0, 60),
        category: entry?.category ?? find.category ?? "other",
        how: ["model"],
        packages: [],
        imports: [],
        envNames: [],
        sources: [at],
        dashboardUrl: entry?.dashboardUrl ?? null,
        pricingUrl: entry?.pricingUrl ?? null,
        checkedLimits: LIMITS_BY_SLUG.has(slug),
        purpose: find.detail || null,
        found,
      };
      map.services.push(service);
      map.services.sort((a, b) => a.name.localeCompare(b.name));
      return true;
    }
    case "env": {
      if (!/^[A-Z][A-Z0-9_]*$/.test(find.name)) return false;
      const area = new Set(areasOf(ctx, map.roles).get(at.path) ?? []);
      if (area.size === 0) area.add(ctx.context.graph.entries.length > 0 ? "unreached" : "shared");
      const env: MapEnv = {
        name: find.name,
        alternatives: [],
        public: PUBLIC_PREFIX.test(find.name),
        service: matchEnv(find.name)?.slug ?? null,
        declared: null,
        note: null,
        optional: false,
        optionalWhy: null,
        areas: [...area].sort(),
        roles: rolesForAreas(area, map.roles),
        reads: [at],
        found,
      };
      map.env.push(env);
      map.env.sort((a, b) => a.name.localeCompare(b.name));
      return true;
    }
    case "cron": {
      if (!find.schedule) return false;
      const cron: MapCron = { path: find.name, schedule: find.schedule, ...describeSchedule(find.schedule), source: at, handler: null, checksSecret: false, kind: cronKind(at), found };
      map.crons.push(cron);
      return true;
    }
    case "webhook": {
      const route = normRoute(find.name);
      const content = (await ctx.context.files.text(at.path)) ?? "";
      const webhook: MapWebhook = { route, file: at.path, service: webhookService(route, content), verifies: content ? verifyLineIn(at.path, content) : null, methods: methodsIn(content), found };
      map.webhooks.push(webhook);
      map.webhooks.sort((a, b) => a.route.localeCompare(b.route));
      return true;
    }
    case "store_app": {
      const platform = storePlatform(at.path);
      if (!platform) return false;
      const app: MapStoreApp = { platform, bundleId: find.name, appName: null, webUrl: null, source: at, found };
      map.storeApps.push(app);
      return true;
    }
    default:
      return false;
  }
}
