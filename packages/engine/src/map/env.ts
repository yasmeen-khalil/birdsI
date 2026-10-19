import type { MapEnv, MapRoles, SourceLine } from "@birdsi/shared";
import { matchEnv, matchPackage } from "../vendors/discover";
import { lineAt, sourceLine, type MapFiles } from "./files";
import { areaOf, reach, type Graph } from "./graph";

const READ = /process\.env\.([A-Z][A-Z0-9_]*)|process\.env\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\]|import\.meta\.env\.([A-Z][A-Z0-9_]*)|Deno\.env\.get\(\s*["']([A-Z][A-Z0-9_]*)["']/g;
const DESTRUCTURE = /\{([^{}]{1,400})\}\s*=\s*process\.env\b/g;
const ROLE_COMPARE = /process\.env\.([A-Z][A-Z0-9_]*)\s*[!=]==?\s*["']([a-z][a-z0-9_-]{0,30})["']|["']([a-z][a-z0-9_-]{0,30})["']\s*[!=]==?\s*process\.env\.([A-Z][A-Z0-9_]*)/g;
const OPTIONAL_NOTE = /optional|inert|unset|leave (it )?(empty|unset|blank)|not (needed|used|required)|only (when|if)|if you (want|use)|later/i;
const PUBLIC_PREFIX = /^(NEXT_PUBLIC_|VITE_|EXPO_PUBLIC_|PUBLIC_|REACT_APP_|NUXT_PUBLIC_)/;
/** Names the platform sets by itself: never "missing" from a project. */
const PLATFORM = /^(NODE_ENV|VERCEL|VERCEL_[A-Z0-9_]+|NEXT_PUBLIC_VERCEL_[A-Z0-9_]+|NEXT_RUNTIME|NEXT_PHASE|CI|PORT|TZ|HOSTNAME|PWD|HOME|PATH)$/;

interface Read {
  name: string;
  file: string;
  line: number;
  guarded: boolean;
  /** Another env name read when this one is unset ("A || B"): either one is enough. */
  alternative: string | null;
}

/** How one codebase becomes several deployments: an env name compared with role names in the code. */
export async function readRoles(files: MapFiles, example: Map<string, { value: string }>): Promise<MapRoles> {
  const byName = new Map<string, { values: Set<string>; sources: SourceLine[] }>();
  for (const file of files.code()) {
    const content = await files.text(file);
    if (!content || !content.includes("process.env")) continue;
    for (const m of content.matchAll(ROLE_COMPARE)) {
      const name = m[1] ?? m[4]!;
      const value = m[2] ?? m[3]!;
      if (!/ROLE|DEPLOYMENT|SURFACE|TARGET|FLAVOR|FLAVOUR/.test(name)) continue;
      const entry = byName.get(name) ?? { values: new Set<string>(), sources: [] };
      entry.values.add(value);
      if (entry.sources.length < 5) entry.sources.push(sourceLine(file, content, lineAt(content, m.index ?? 0)));
      byName.set(name, entry);
    }
  }
  const best = [...byName.entries()].sort((a, b) => b[1].values.size - a[1].values.size)[0];
  if (!best) return { envName: null, defaultRole: null, names: [], sources: [] };
  const [envName, { values, sources }] = best;
  const fromExample = example.get(envName)?.value ?? "";
  const defaultRole = /^[a-z][a-z0-9_-]{0,30}$/.test(fromExample) ? fromExample : values.has("app") ? "app" : "app";
  return { envName, defaultRole, names: [...new Set([defaultRole, ...values])], sources };
}

/** The example env file: each name, its line (never its value) and the comment block above it. */
export async function readExample(files: MapFiles): Promise<Map<string, { declared: SourceLine; note: string | null; value: string }>> {
  const out = new Map<string, { declared: SourceLine; note: string | null; value: string }>();
  const examples = [...files.paths].filter((p) => /(^|\/)\.env\.(example|sample|template)$/.test(p)).sort((a, b) => a.split("/").length - b.split("/").length);
  for (const path of examples) {
    const content = await files.text(path);
    if (!content) continue;
    // A comment block applies to the names under it, until the next comment block or a blank line.
    let comment: string[] = [];
    let lastWasComment = false;
    content.split("\n").forEach((raw, i) => {
      const line = raw.trim();
      if (line === "") {
        comment = [];
        lastWasComment = false;
        return;
      }
      if (line.startsWith("#")) {
        const text = line.replace(/^#+\s?/, "");
        comment = lastWasComment ? [...comment, text] : [text];
        lastWasComment = true;
        return;
      }
      lastWasComment = false;
      const m = line.match(/^(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
      if (!m) return;
      const name = m[1]!;
      if (out.has(name)) return;
      // The value is kept only to read a role's default name; it is never stored in the map.
      out.set(name, { declared: { path, line: i + 1, text: `${name}=` }, note: comment.length > 0 ? comment.join(" ").slice(0, 200) : null, value: (m[2] ?? "").trim().replace(/^["']|["']$/g, "") });
    });
  }
  return out;
}

async function readsIn(files: MapFiles): Promise<Read[]> {
  const out: Read[] = [];
  for (const file of files.code()) {
    const content = await files.text(file);
    if (!content || !(content.includes("process.env") || content.includes("import.meta.env") || content.includes("Deno.env"))) continue;
    for (const m of content.matchAll(READ)) {
      const name = m[1] ?? m[2] ?? m[3] ?? m[4]!;
      const at = m.index ?? 0;
      // A default value in the code ("?? 50", "|| 'https://...'") makes a name optional. An empty one ("?? ''") is only null safety,
      // and another env name ("|| process.env.OTHER") makes the two alternatives, either one enough.
      const after = content.slice(at + m[0].length, at + m[0].length + 60);
      const other = after.match(/^\s*(?:\?\?|\|\|)\s*process\.env\.([A-Z][A-Z0-9_]*)/)?.[1] ?? null;
      const fallback = after.match(/^\s*(\?\?|\|\|)\s*(.{0,30})/);
      const guarded = !other && Boolean(fallback && !/^(["'`]\s*["'`]|null\b|undefined\b|false\b|\[\s*\]|\{\s*\}|""|'')/.test(fallback[2]!.trim()) && fallback[2]!.trim() !== "");
      out.push({ name, file, line: lineAt(content, at), guarded, alternative: other });
    }
    for (const m of content.matchAll(DESTRUCTURE)) {
      for (const part of m[1]!.split(",")) {
        const name = part.trim().split(/[\s:=]/)[0] ?? "";
        if (/^[A-Z][A-Z0-9_]*$/.test(name)) out.push({ name, file, line: lineAt(content, m.index ?? 0), guarded: /=/.test(part), alternative: null });
      }
    }
  }
  return out;
}

/** Which areas each file runs in, from the routes that reach it. */
export function areasByFile(graph: Graph, roles: MapRoles): Map<string, Set<string>> {
  const byArea = new Map<string, string[]>();
  for (const entry of graph.entries) {
    const area = areaOf(entry, roles.names, roles.defaultRole);
    byArea.set(area, [...(byArea.get(area) ?? []), entry.file]);
  }
  const out = new Map<string, Set<string>>();
  for (const [area, entries] of byArea) {
    for (const file of reach(graph, entries)) out.set(file, (out.get(file) ?? new Set()).add(area));
  }
  return out;
}

export async function readEnv(files: MapFiles, graph: Graph, roles: MapRoles, example: Map<string, { declared: SourceLine; note: string | null; value: string }>): Promise<MapEnv[]> {
  const reads = await readsIn(files);
  const areas = areasByFile(graph, roles);
  const hasEntries = graph.entries.length > 0;
  // A vendor's SDK reads its own names (Clerk's keys): those run wherever the SDK is imported.
  const sdkAreas = new Map<string, Set<string>>();
  for (const [pkg, places] of graph.packageImports) {
    const slug = matchPackage(pkg)?.slug;
    if (!slug) continue;
    const set = sdkAreas.get(slug) ?? new Set<string>();
    for (const p of places) for (const a of areas.get(p.file) ?? []) set.add(a);
    sdkAreas.set(slug, set);
  }
  const names = new Set([...reads.map((r) => r.name), ...example.keys()]);
  const out: MapEnv[] = [];
  for (const name of names) {
    if (PLATFORM.test(name)) continue;
    const mine = reads.filter((r) => r.name === name);
    const fromExample = example.get(name) ?? null;
    const area = new Set<string>();
    for (const r of mine) {
      const a = areas.get(r.file);
      if (a && a.size > 0) for (const x of a) area.add(x);
      else area.add(hasEntries ? "unreached" : "shared");
    }
    if (mine.length === 0) {
      const service = matchEnv(name)?.slug;
      const viaSdk = service ? sdkAreas.get(service) : undefined;
      // Read by the vendor's SDK where it is imported, or else only declared in the example file.
      if (viaSdk && viaSdk.size > 0) for (const x of viaSdk) area.add(x);
      else area.add("declared");
    } else if (area.has("unreached")) {
      const service = matchEnv(name)?.slug;
      for (const x of (service ? sdkAreas.get(service) : undefined) ?? []) area.add(x);
      if (area.size > 1) area.delete("unreached");
    }
    const productAreas = new Set(["shared", "cron", "webhook", "declared", ...(roles.defaultRole ? [roles.defaultRole] : [])]);
    const roleList = roles.names.length === 0 ? [] : roles.names.filter((r) => (r === roles.defaultRole ? [...area].some((a) => productAreas.has(a)) : area.has(r)));
    const noteOptional = fromExample?.note ? OPTIONAL_NOTE.test(fromExample.note) : false;
    const allGuarded = mine.length > 0 && mine.every((r) => r.guarded);
    const sources: SourceLine[] = [];
    for (const r of mine.slice(0, 8)) {
      const content = await files.text(r.file);
      if (content) sources.push(sourceLine(r.file, content, r.line));
    }
    const alternatives = new Set<string>();
    for (const r of reads) {
      if (r.name === name && r.alternative) alternatives.add(r.alternative);
      if (r.alternative === name) alternatives.add(r.name);
    }
    out.push({
      name,
      alternatives: [...alternatives].sort(),
      public: PUBLIC_PREFIX.test(name),
      service: matchEnv(name)?.slug ?? null,
      declared: fromExample?.declared ?? null,
      note: fromExample?.note ?? null,
      optional: noteOptional || allGuarded,
      optionalWhy: noteOptional ? `The example env file says: ${fromExample!.note}` : allGuarded ? "Every read in the code has a default value." : null,
      areas: [...area].sort(),
      roles: roleList,
      reads: sources,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
