import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { CallSite, ProjectHints, VendorDraft } from "@birdsi/shared";
import type { Inventory } from "../inventory/walk";
import type { RawDependency } from "../inventory/manifests";
import { CATALOG, CATALOG_BY_SLUG, type CatalogEntry } from "./catalog";
import { maskSecrets } from "../checks/secrets";

/**
 * Finds every outside service the code depends on, deterministically:
 * package names, env var names, URL domains, config files and the Stripe
 * Projects state file. No model is involved here; the result is Proven.
 */

const MAX_FILES = 2500;
const MAX_FILE_BYTES = 200_000;

/** Env names that are the app's own, not a vendor's. */
const GENERIC_ENV = new Set([
  "NODE_ENV",
  "PORT",
  "HOST",
  "HOSTNAME",
  "DATABASE_URL",
  "DB_URL",
  "REDIS_URL",
  "API_KEY",
  "API_URL",
  "API_BASE_URL",
  "SECRET",
  "SECRET_KEY",
  "JWT_SECRET",
  "SESSION_SECRET",
  "AUTH_SECRET",
  "NEXTAUTH_SECRET",
  "NEXTAUTH_URL",
  "APP_URL",
  "BASE_URL",
  "PUBLIC_URL",
  "DEBUG",
  "LOG_LEVEL",
  "TZ",
  "CI",
  "HOME",
  "PATH",
  "ENV",
  "ENVIRONMENT",
  "APP_ENV",
  "ADMIN_EMAIL",
  "ADMIN_PASSWORD",
  "ENCRYPTION_KEY",
  "WEBHOOK_SECRET",
  "CRON_SECRET",
  "INTERNAL_SECRET",
]);

const ENV_REF = /(?:process\.env(?:\.|\[["'])|import\.meta\.env\.|os\.environ(?:\.get\(|\[)["']?|os\.getenv\(["']|Deno\.env\.get\(["']|System\.getenv\(["']|ENV(?:\.fetch)?[\[(]["']|getenv\(["']|env\(["'])([A-Z][A-Z0-9_]{2,})/g;
const ENV_LINE = /^([A-Z][A-Z0-9_]{2,})\s*=/;
const URL_REF = /https?:\/\/([a-z0-9][a-z0-9.-]+\.[a-z]{2,})(?::\d+)?(?:[/"'`\s)]|$)/gi;

interface Hit {
  entry: CatalogEntry | null;
  slug: string;
  name: string;
  detectedBy: Set<VendorDraft["detectedBy"][number]>;
  packages: Set<string>;
  envVars: Set<string>;
  callSites: CallSite[];
  /** For unknown vendors: domains seen, to help the web description. */
  domains: Set<string>;
}

/** At most this many vendors per scan, catalog vendors first; each one can cost web searches and a model call later. */
export const MAX_VENDORS_PER_SCAN = 60;
/** Of those, at most this many that are not in the catalog (guessed from env names or Stripe Projects). */
export const MAX_UNKNOWN_VENDORS = 10;

/** Slugs end up in URLs and database filters, so they are reduced to [a-z0-9-] and 40 characters. */
export function cleanSlug(raw: string): string | null {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40)
    .replace(/-$/, "");
  return slug.length > 0 ? slug : null;
}

function hitFor(map: Map<string, Hit>, entry: CatalogEntry | null, rawSlug: string, name: string): Hit {
  const slug = cleanSlug(rawSlug);
  const fresh = (key: string): Hit => ({ entry, slug: key, name: name.slice(0, 60), detectedBy: new Set(), packages: new Set(), envVars: new Set(), callSites: [], domains: new Set() });
  // An unusable slug still gets a hit to write into, but it is never kept.
  if (!slug) return fresh("");
  let hit = map.get(slug);
  if (!hit) {
    hit = fresh(slug);
    map.set(slug, hit);
  }
  return hit;
}

/** Catalog vendors first, then the unknown ones with the most evidence, within the caps. */
export function capVendors<T extends { entry: unknown; envVars: Set<string>; callSites: unknown[]; detectedBy: Set<unknown> }>(hits: T[]): T[] {
  const weight = (h: T) => h.envVars.size + h.callSites.length + h.detectedBy.size;
  const known = hits.filter((h) => h.entry !== null);
  const unknown = hits
    .filter((h) => h.entry === null)
    .sort((a, b) => weight(b) - weight(a))
    .slice(0, MAX_UNKNOWN_VENDORS);
  return [...known, ...unknown].slice(0, MAX_VENDORS_PER_SCAN);
}

function slugFromEnv(name: string): { slug: string; label: string } | null {
  if (GENERIC_ENV.has(name)) return null;
  const stripped = name.replace(/^(NEXT_PUBLIC_|VITE_|EXPO_PUBLIC_|PUBLIC_|REACT_APP_|NUXT_PUBLIC_|NUXT_)/, "");
  // For a service birdsI does not know, only a key-shaped name is evidence. A bare
  // SECRET, CLIENT_ID or URL is usually the app's own setting or a sign-in provider.
  const m = stripped.match(/^([A-Z0-9]+(?:_[A-Z0-9]+)*?)_(API_KEY|APIKEY|API_TOKEN|ACCESS_TOKEN|AUTH_TOKEN|TOKEN|SECRET_KEY|PUBLISHABLE_KEY|PRIVATE_KEY|DSN|APP_ID|PROJECT_ID|API_URL|ENDPOINT)$/);
  if (!m) return null;
  const vendorPart = m[1]!;
  if (vendorPart.length < 3 || GENERIC_ENV.has(vendorPart)) return null;
  const first = vendorPart.split("_")[0]!;
  if (/^(APP|DB|DATABASE|API|AUTH|JWT|SESSION|SERVER|CLIENT|PUBLIC|PRIVATE|INTERNAL|ADMIN|USER|OPS|DEV|TEST|STAGING|PROD|SMTP|MAIL|EMAIL|REDIS|POSTGRES|MYSQL|MONGO|MONGODB|S3|CDN|SITE|WEB|IOS|ANDROID|NEXT|NEXTAUTH|CRON|WEBHOOK|OAUTH|GOOGLE|APPLE|FACEBOOK|TWITTER|LINKEDIN|DISCORD|SLACK|STUDENT|TEACHER|SCHOOL)$/.test(first)) {
    // The app's own settings, sign-in providers and infrastructure shorthand are not billed vendors.
    return null;
  }
  const slug = vendorPart.toLowerCase().replace(/_/g, "-");
  const label = vendorPart
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  return { slug, label };
}

function matchEnv(name: string): CatalogEntry | null {
  for (const entry of CATALOG) for (const re of entry.envVars) if (re.test(name)) return entry;
  return null;
}

function matchDomain(domain: string): CatalogEntry | null {
  const d = domain.toLowerCase();
  for (const entry of CATALOG) for (const known of entry.domains) if (d === known || d.endsWith(`.${known}`)) return entry;
  return null;
}

function matchPackage(name: string): CatalogEntry | null {
  for (const entry of CATALOG) for (const re of entry.packages) if (re.test(name)) return entry;
  return null;
}

function matchConfig(path: string): CatalogEntry | null {
  for (const entry of CATALOG) for (const re of entry.configFiles) if (re.test(path)) return entry;
  return null;
}

function isEnvFile(path: string): boolean {
  const base = basename(path);
  return /^\.env(\.(example|sample|template|local\.example|development|production|test))?$/.test(base) || base === ".env.example";
}

function isScannableSource(file: { path: string; language: string | null; bytes: number }): boolean {
  if (file.bytes > MAX_FILE_BYTES) return false;
  if (file.language) return true;
  return isEnvFile(file.path) || /\.(json|toml|ya?ml|env|cfg|ini|conf)$/i.test(file.path);
}

export async function discoverVendors(inventory: Inventory, rawDependencies: RawDependency[], hints: ProjectHints | null): Promise<VendorDraft[]> {
  const hits = new Map<string, Hit>();

  // 1. Packages
  for (const dep of rawDependencies) {
    const entry = matchPackage(dep.name);
    if (!entry) continue;
    const hit = hitFor(hits, entry, entry.slug, entry.name);
    hit.detectedBy.add("package");
    hit.packages.add(dep.name);
  }

  // 2. Config files
  for (const file of inventory.files) {
    const entry = matchConfig(file.path);
    if (!entry) continue;
    const hit = hitFor(hits, entry, entry.slug, entry.name);
    hit.detectedBy.add("config");
    if (hit.callSites.length < 20) hit.callSites.push({ path: file.path, line: 1, excerpt: basename(file.path) });
  }

  // 3. Env references and URLs inside files
  const files = inventory.files.filter(isScannableSource).slice(0, MAX_FILES);
  for (const file of files) {
    let content: string;
    try {
      content = await readFile(join(inventory.root, file.path), "utf8");
    } catch {
      continue;
    }
    const lines = content.split("\n");
    const envFile = isEnvFile(file.path);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const names: string[] = [];
      if (envFile) {
        const m = line.match(ENV_LINE);
        if (m) names.push(m[1]!);
      }
      for (const m of line.matchAll(ENV_REF)) names.push(m[1]!);
      for (const name of names) {
        const entry = matchEnv(name);
        if (entry) {
          const hit = hitFor(hits, entry, entry.slug, entry.name);
          hit.detectedBy.add("env");
          hit.envVars.add(name);
          if (!envFile && hit.callSites.length < 20) hit.callSites.push({ path: file.path, line: i + 1, excerpt: maskSecrets(line.trim()).slice(0, 160) });
          continue;
        }
        const guess = slugFromEnv(name);
        if (!guess) continue;
        const hit = hitFor(hits, null, guess.slug, guess.label);
        hit.detectedBy.add("env");
        hit.envVars.add(name);
        if (!envFile && hit.callSites.length < 20) hit.callSites.push({ path: file.path, line: i + 1, excerpt: maskSecrets(line.trim()).slice(0, 160) });
      }
      if (!envFile) {
        for (const m of line.matchAll(URL_REF)) {
          const domain = m[1]!;
          const entry = matchDomain(domain);
          if (!entry) continue;
          const hit = hitFor(hits, entry, entry.slug, entry.name);
          hit.detectedBy.add("url");
          hit.domains.add(domain);
          if (hit.callSites.length < 20 && !hit.callSites.some((c) => c.path === file.path && c.line === i + 1)) {
            hit.callSites.push({ path: file.path, line: i + 1, excerpt: maskSecrets(line.trim()).slice(0, 160) });
          }
        }
      }
    }
  }

  // 4. Stripe Projects state, committed to the repo or collected by the CLI.
  const projectServices = stripeProjectServices(inventory, hints);
  for (const service of await projectServices) {
    const entry = CATALOG_BY_SLUG.get(service.slug) ?? matchDomain(service.slug) ?? null;
    const hit = hitFor(hits, entry, entry?.slug ?? service.slug, entry?.name ?? service.name);
    hit.detectedBy.add("projects");
  }

  // The app's own hosting shows up only as config; GitHub shows up only as workflows. Both count.
  const drafts: VendorDraft[] = [];
  for (const hit of capVendors([...hits.values()])) {
    const entry = hit.entry;
    drafts.push({
      slug: hit.slug,
      name: hit.name,
      category: entry?.category ?? "other",
      what: entry?.what ?? "",
      purpose: null,
      detectedBy: [...hit.detectedBy],
      packages: [...hit.packages].sort(),
      envVars: [...hit.envVars].sort(),
      callSites: hit.callSites,
      pricingUrl: entry?.pricingUrl ?? null,
      docsUrl: entry?.docsUrl ?? null,
      connectable: Boolean(entry?.connector),
    });
  }
  return drafts.sort((a, b) => a.name.localeCompare(b.name));
}

interface ProjectService {
  slug: string;
  name: string;
}

/** Services from Stripe Projects: `.projects/state.json` in the repo, or the CLI's status output. */
async function stripeProjectServices(inventory: Inventory, hints: ProjectHints | null): Promise<ProjectService[]> {
  const out = new Map<string, ProjectService>();
  const add = (provider: unknown) => {
    if (typeof provider !== "string" || provider.trim() === "") return;
    const slug = provider.toLowerCase().split("/")[0]!.trim();
    if (!out.has(slug)) out.set(slug, { slug, name: slug.charAt(0).toUpperCase() + slug.slice(1) });
  };
  const walk = (value: unknown, depth = 0) => {
    if (depth > 4 || value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const v of value) walk(v, depth + 1);
      return;
    }
    const obj = value as Record<string, unknown>;
    if (typeof obj["provider"] === "string") add(obj["provider"]);
    for (const [k, v] of Object.entries(obj)) {
      if (k === "services" || k === "resources" || k === "providers") walk(v, depth + 1);
      else if (typeof v === "object") walk(v, depth + 1);
    }
  };
  const stateFile = inventory.files.find((f) => f.path === ".projects/state.json");
  if (stateFile) {
    try {
      walk(JSON.parse(await readFile(join(inventory.root, stateFile.path), "utf8")));
    } catch {
      // Unreadable state file: the hints may still carry it.
    }
  }
  if (hints?.stripeProjects) {
    walk(hints.stripeProjects.state);
    walk(hints.stripeProjects.status);
  }
  return [...out.values()];
}
