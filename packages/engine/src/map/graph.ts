import { dirOf, joinPath, lineAt, type MapFiles } from "./files";

/**
 * Which deployment runs a file: an import graph from each Next.js entry point
 * (pages, layouts, routes, the proxy) to the files they reach. A file reached
 * from an ops route runs on the ops deployment; one reached from a layout or
 * the proxy runs on every deployment.
 */

export interface Unit {
  /** Repository-relative folder of the package.json, "" for the root. */
  path: string;
  appDir: string | null;
  pagesDir: string | null;
  aliases: Array<{ prefix: string; targets: string[] }>;
}

export interface Entry {
  file: string;
  /** The address it serves, route groups left out: "/api/webhooks/clerk". */
  route: string;
  /** Folder names on the way, route groups without their brackets: ["(ops)" as "ops", "api", ...]. */
  segments: string[];
  kind: "page" | "route" | "layout" | "proxy" | "config" | "other";
}

export interface Graph {
  entries: Entry[];
  /** file -> files it imports (resolved, inside the repository). */
  edges: Map<string, Set<string>>;
  /** Bare package imports: package -> where. */
  packageImports: Map<string, Array<{ file: string; line: number }>>;
}

const ENTRY_FILE = /^(page|layout|route|template|loading|error|not-found|default|global-error|opengraph-image|twitter-image|icon|apple-icon|sitemap|robots|manifest)\.(tsx?|jsx?|mjs)$/;
const EXTENSIONS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", "/index.ts", "/index.tsx", "/index.js", "/index.jsx"];
const IMPORT = /(?:^|[\s;])(?:import|export)\s+(type\s+)?(?:[\w*{}\s,$]+?\s+from\s+)?["']([^"'\n]+)["']|require\(\s*["']([^"'\n]+)["']\s*\)|import\(\s*["']([^"'\n]+)["']\s*\)/g;

function stripJsonComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1").replace(/,(\s*[}\]])/g, "$1");
}

/** A deployable unit's route folders and import aliases, from its files and tsconfig. */
export async function unitAt(files: MapFiles, path: string): Promise<Unit> {
  const at = (p: string) => (path ? `${path}/${p}` : p);
  const prefixHas = (dir: string) => [...files.paths].some((f) => f.startsWith(`${dir}/`));
  const appDir = [at("src/app"), at("app")].find(prefixHas) ?? null;
  const pagesDir = [at("src/pages"), at("pages")].find(prefixHas) ?? null;
  const aliases: Unit["aliases"] = [];
  for (const name of ["tsconfig.json", "jsconfig.json"]) {
    const text = await files.text(at(name));
    if (!text) continue;
    try {
      const json = JSON.parse(stripJsonComments(text)) as { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } };
      const base = joinPath(path, json.compilerOptions?.baseUrl ?? ".");
      for (const [pattern, targets] of Object.entries(json.compilerOptions?.paths ?? {})) {
        aliases.push({ prefix: pattern.replace(/\*$/, ""), targets: targets.map((t) => joinPath(base, t.replace(/\*$/, ""))) });
      }
    } catch {
      // A tsconfig birdsI cannot read leaves the default alias below.
    }
    break;
  }
  if (!aliases.some((a) => a.prefix === "@/")) aliases.push({ prefix: "@/", targets: [prefixHas(at("src")) ? at("src") : path] });
  return { path, appDir, pagesDir, aliases };
}

export function entriesOf(unit: Unit, paths: Iterable<string>): Entry[] {
  const out: Entry[] = [];
  const at = (p: string) => (unit.path ? `${unit.path}/${p}` : p);
  for (const file of paths) {
    if (unit.appDir && file.startsWith(`${unit.appDir}/`)) {
      const rest = file.slice(unit.appDir.length + 1).split("/");
      const name = rest.pop()!;
      if (!ENTRY_FILE.test(name)) continue;
      const segments = rest.map((s) => s.replace(/^\((.*)\)$/, "$1"));
      const route = "/" + rest.filter((s) => !/^\(.*\)$/.test(s) && !s.startsWith("@")).join("/");
      const kind = name.startsWith("route.") ? "route" : name.startsWith("layout.") ? "layout" : name.startsWith("page.") ? "page" : "other";
      out.push({ file, route: route === "/" ? "/" : route.replace(/\/$/, ""), segments, kind });
    } else if (unit.pagesDir && file.startsWith(`${unit.pagesDir}/`) && /\.(tsx?|jsx?)$/.test(file)) {
      const rest = file.slice(unit.pagesDir.length + 1).replace(/\.(tsx?|jsx?)$/, "").split("/");
      if (rest[rest.length - 1] === "index") rest.pop();
      const isApi = rest[0] === "api";
      out.push({ file, route: "/" + rest.join("/"), segments: rest, kind: isApi ? "route" : "page" });
    }
  }
  for (const name of ["middleware", "proxy", "instrumentation"]) {
    for (const ext of [".ts", ".js", ".mjs"]) {
      for (const candidate of [at(`${name}${ext}`), at(`src/${name}${ext}`)]) {
        if ([...paths].includes(candidate)) out.push({ file: candidate, route: "*", segments: [], kind: "proxy" });
      }
    }
  }
  for (const ext of [".ts", ".js", ".mjs"]) {
    const candidate = at(`next.config${ext}`);
    if ([...paths].includes(candidate)) out.push({ file: candidate, route: "*", segments: [], kind: "config" });
  }
  return out;
}

function resolve(files: MapFiles, unit: Unit, from: string, spec: string): string | null {
  let bases: string[] = [];
  if (spec.startsWith("./") || spec.startsWith("../")) bases = [joinPath(dirOf(from), spec)];
  else {
    const alias = unit.aliases.filter((a) => spec.startsWith(a.prefix)).sort((a, b) => b.prefix.length - a.prefix.length)[0];
    if (!alias) return null;
    bases = alias.targets.map((t) => joinPath(t, spec.slice(alias.prefix.length)));
  }
  for (const base of bases) for (const ext of EXTENSIONS) if (files.has(base + ext)) return base + ext;
  return null;
}

function packageName(spec: string): string | null {
  if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("node:")) return null;
  const parts = spec.split("/");
  return spec.startsWith("@") ? (parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null) : parts[0]!;
}

export async function buildGraph(files: MapFiles, units: Unit[]): Promise<Graph> {
  const edges = new Map<string, Set<string>>();
  const packageImports = new Map<string, Array<{ file: string; line: number }>>();
  const unitOf = (file: string) => units.filter((u) => u.path === "" || file.startsWith(`${u.path}/`)).sort((a, b) => b.path.length - a.path.length)[0] ?? null;
  for (const file of files.code()) {
    const content = await files.text(file);
    if (!content) continue;
    const unit = unitOf(file);
    const out = new Set<string>();
    for (const m of content.matchAll(IMPORT)) {
      if (m[1]) continue; // import type: no code runs
      const spec = m[2] ?? m[3] ?? m[4];
      if (!spec) continue;
      const pkg = packageName(spec);
      const aliased = unit?.aliases.some((a) => spec.startsWith(a.prefix)) ?? false;
      if (pkg && !aliased) {
        const list = packageImports.get(pkg) ?? [];
        if (list.length < 20) list.push({ file, line: lineAt(content, m.index ?? 0) + (m[0].startsWith("\n") ? 1 : 0) });
        packageImports.set(pkg, list);
        continue;
      }
      if (!unit) continue;
      const target = resolve(files, unit, file, spec);
      if (target) out.add(target);
    }
    edges.set(file, out);
  }
  const entries = units.flatMap((u) => entriesOf(u, files.paths));
  return { entries, edges, packageImports };
}

/** Every file reached from the given entry files. */
export function reach(graph: Graph, from: string[]): Set<string> {
  const seen = new Set<string>(from);
  const queue = [...from];
  while (queue.length > 0) {
    const next = queue.pop()!;
    for (const target of graph.edges.get(next) ?? []) {
      if (seen.has(target)) continue;
      seen.add(target);
      queue.push(target);
    }
  }
  return seen;
}

export function isWebhookRoute(entry: Entry): boolean {
  return entry.kind === "route" && entry.route.split("/").some((s) => s === "webhook" || s === "webhooks");
}

/**
 * The area an entry runs in: a deployment role when its folders name one
 * (an "admin" folder counts as ops when the app has an ops role), "cron" and
 * "webhook" for those routes, "shared" for everything else.
 */
export function areaOf(entry: Entry, roles: string[], defaultRole: string | null): string {
  const others = roles.filter((r) => r !== defaultRole);
  for (const s of entry.segments) if (others.includes(s)) return s;
  if (others.includes("ops") && entry.segments.includes("admin")) return "ops";
  if (entry.kind === "route" && /^\/api\/cron(\/|$)/.test(entry.route)) return "cron";
  if (isWebhookRoute(entry)) return "webhook";
  return "shared";
}
