import { LIMITS_BY_SLUG, type MapService, type MapUnit, type ServiceMap, type SourceLine, type VendorDraft } from "@birdsi/shared";
import type { RawDependency } from "../inventory/manifests";
import type { Inventory } from "../inventory/walk";
import { CATALOG_BY_SLUG } from "../vendors/catalog";
import { matchPackage } from "../vendors/discover";
import { dirOf, MapFiles, sourceLine } from "./files";
import { buildGraph, unitAt } from "./graph";
import { readEnv, readExample, readRoles } from "./env";
import { readCrons, readMigrations, readPublicSurface, readStoreApps, readWebhooks } from "./parts";
import type { Graph, Unit } from "./graph";

/** What the rules built the map from, kept so the model's reading can place its finds the same way. */
export interface MapContext {
  files: MapFiles;
  graph: Graph;
  units: Unit[];
}

const FRAMEWORKS: Array<[RegExp, string]> = [
  [/^next$/, "Next.js"],
  [/^nuxt$/, "Nuxt"],
  [/^@remix-run\//, "Remix"],
  [/^@sveltejs\/kit$/, "SvelteKit"],
  [/^astro$/, "Astro"],
  [/^expo$/, "Expo"],
  [/^vite$/, "Vite"],
  [/^express$/, "Express"],
  [/^hono$/, "Hono"],
  [/^fastify$/, "Fastify"],
];

export interface MapMeta {
  commit: string | null;
  branch: string | null;
  readAt?: string;
}

async function readUnits(files: MapFiles): Promise<MapUnit[]> {
  const out: MapUnit[] = [];
  for (const path of [...files.paths].filter((p) => /(^|\/)package\.json$/.test(p)).sort()) {
    const content = await files.text(path);
    if (!content) continue;
    try {
      const pkg = JSON.parse(content) as { name?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
      const framework = FRAMEWORKS.find(([re]) => deps.some((d) => re.test(d)))?.[1] ?? null;
      if (framework || dirOf(path) === "") out.push({ path: dirOf(path), name: pkg.name ?? null, framework });
    } catch {
      // Not JSON birdsI can read.
    }
  }
  return out.length > 0 ? out : [{ path: "", name: null, framework: null }];
}

/**
 * Turns one snapshot of an app's code into its service map, by rules, with
 * the file and line for every entry. Uses the vendors discovery already found.
 */
export async function buildServiceMap(inventory: Inventory, rawDependencies: RawDependency[], vendors: VendorDraft[], meta: MapMeta): Promise<ServiceMap> {
  return (await buildServiceMapWithContext(inventory, rawDependencies, vendors, meta)).map;
}

/** The map and the files, graph and units it was read from. */
export async function buildServiceMapWithContext(inventory: Inventory, rawDependencies: RawDependency[], vendors: VendorDraft[], meta: MapMeta): Promise<{ map: ServiceMap; context: MapContext }> {
  const files = new MapFiles(inventory);
  const units = await readUnits(files);
  const unitInfo = await Promise.all(units.filter((u) => u.framework !== null || units.length === 1).map((u) => unitAt(files, u.path)));
  const graph = await buildGraph(files, unitInfo);
  const example = await readExample(files);
  const roles = await readRoles(files, example);
  const env = await readEnv(files, graph, roles, example);

  // SDK imports, by the catalog's package names.
  const importsBySlug = new Map<string, SourceLine[]>();
  for (const [pkg, places] of graph.packageImports) {
    const entry = matchPackage(pkg);
    if (!entry) continue;
    const list = importsBySlug.get(entry.slug) ?? [];
    for (const p of places) {
      if (list.length >= 12) break;
      const content = await files.text(p.file);
      if (content) list.push(sourceLine(p.file, content, p.line));
    }
    importsBySlug.set(entry.slug, list);
  }

  const services: MapService[] = vendors.map((v) => {
    const entry = CATALOG_BY_SLUG.get(v.slug);
    const imports = importsBySlug.get(v.slug) ?? [];
    const how = new Set<MapService["how"][number]>(v.detectedBy);
    if (imports.length > 0) how.add("import");
    return {
      slug: v.slug,
      name: v.name,
      category: v.category,
      how: [...how],
      packages: v.packages,
      imports,
      envNames: v.envVars,
      sources: v.callSites.slice(0, 12).map((c) => ({ path: c.path, line: c.line, text: c.excerpt })),
      dashboardUrl: entry?.dashboardUrl ?? null,
      pricingUrl: v.pricingUrl,
      checkedLimits: LIMITS_BY_SLUG.has(v.slug),
      purpose: v.purpose,
      found: null,
    };
  });

  const map: ServiceMap = {
    version: 1,
    readAt: meta.readAt ?? new Date().toISOString(),
    commit: meta.commit,
    branch: meta.branch,
    units,
    services,
    env,
    roles,
    crons: await readCrons(files, unitInfo, graph),
    webhooks: await readWebhooks(files, graph),
    storeApps: await readStoreApps(files),
    migrations: await readMigrations(files),
    publicSurface: await readPublicSurface(files, unitInfo),
    counts: { files: inventory.files.length, packages: rawDependencies.length, routes: graph.entries.filter((e) => e.kind === "route" || e.kind === "page").length },
    reader: null,
    modelFinds: [],
    fileHashes: {},
  };
  return { map, context: { files, graph, units: unitInfo } };
}

export { describeSchedule, parseMarkers } from "./parts";
