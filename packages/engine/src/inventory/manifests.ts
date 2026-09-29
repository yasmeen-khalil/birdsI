import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { Ecosystem } from "@birdsi/shared";
import type { Inventory } from "./walk";

export interface RawDependency {
  ecosystem: Ecosystem;
  name: string;
  /** Exact version when a lockfile gives one, otherwise the declared range with the operator stripped. */
  version: string;
  declared: string;
  manifestPath: string;
  direct: boolean;
}

/**
 * Finds dependency manifests across ecosystems and extracts what is in use.
 * Lockfiles win over declared ranges because a vulnerability is about the
 * version actually installed. Each ecosystem is a small parser behind the
 * same interface, so adding one is a new function, not a restructure.
 */
export async function collectDependencies(inventory: Inventory): Promise<RawDependency[]> {
  const out: RawDependency[] = [];
  const paths = new Set(inventory.files.map((f) => f.path));
  const lockPaths = await findLockfiles(inventory.root, paths);

  for (const file of inventory.files) {
    const name = basename(file.path);
    const dir = dirname(file.path);
    const read = () => readFile(join(inventory.root, file.path), "utf8");
    try {
      if (name === "package.json") out.push(...(await parsePackageJson(await read(), file.path, dir, inventory.root, lockPaths)));
      else if (name === "requirements.txt" || /^requirements[-_.\w]*\.txt$/.test(name)) out.push(...parseRequirements(await read(), file.path));
      else if (name === "pyproject.toml") out.push(...parsePyproject(await read(), file.path));
      else if (name === "Pipfile") out.push(...parsePipfile(await read(), file.path));
      else if (name === "go.mod") out.push(...parseGoMod(await read(), file.path));
      else if (name === "Cargo.toml") out.push(...parseCargoToml(await read(), file.path));
      else if (name === "Gemfile") out.push(...(await parseGemfile(await read(), file.path, dir, inventory.root)));
      else if (name === "composer.json") out.push(...parseComposer(await read(), file.path));
      else if (name === "pom.xml") out.push(...parsePom(await read(), file.path));
      else if (name.endsWith(".csproj") || name.endsWith(".fsproj")) out.push(...parseCsproj(await read(), file.path));
      else if (name === "pubspec.yaml") out.push(...parsePubspec(await read(), file.path));
      else if (name === "mix.exs") out.push(...parseMixExs(await read(), file.path));
    } catch {
      // A malformed manifest is skipped; the review step will still read it.
    }
  }
  return dedupe(out);
}

function dedupe(list: RawDependency[]): RawDependency[] {
  const seen = new Map<string, RawDependency>();
  for (const dep of list) {
    const key = `${dep.ecosystem}:${dep.name}:${dep.version}:${dep.manifestPath}`;
    if (!seen.has(key)) seen.set(key, dep);
  }
  return [...seen.values()];
}

async function findLockfiles(root: string, paths: Set<string>): Promise<Map<string, string>> {
  // Lockfiles are excluded from the inventory walk, so probe for them directly.
  const found = new Map<string, string>();
  const dirs = new Set<string>();
  for (const p of paths) if (basename(p) === "package.json") dirs.add(dirname(p));
  for (const dir of dirs) {
    for (const lock of ["package-lock.json", "pnpm-lock.yaml", "yarn.lock"]) {
      const rel = dir === "." ? lock : `${dir}/${lock}`;
      try {
        const content = await readFile(join(root, rel), "utf8");
        found.set(rel, content);
      } catch {
        // Not present.
      }
    }
  }
  return found;
}

export function cleanVersion(range: string): string {
  const trimmed = range.trim();
  const match = trimmed.match(/\d+(?:\.\d+){0,3}(?:[-+][0-9A-Za-z.-]+)?/);
  return match ? match[0] : trimmed;
}

async function parsePackageJson(
  content: string,
  manifestPath: string,
  dir: string,
  _root: string,
  lockfiles: Map<string, string>,
): Promise<RawDependency[]> {
  const pkg = JSON.parse(content) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; peerDependencies?: Record<string, string> };
  const declared = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const locked = readNpmLock(dir, lockfiles);
  const out: RawDependency[] = [];
  for (const [name, range] of Object.entries(declared)) {
    if (typeof range !== "string") continue;
    if (/^(file:|link:|workspace:|git\+|github:|https?:)/.test(range) || range === "*") {
      // Local, workspace and git dependencies have no registry version to check.
      continue;
    }
    const version = locked.get(name) ?? cleanVersion(range);
    out.push({ ecosystem: "npm", name, version, declared: range, manifestPath, direct: true });
  }
  return out;
}

function readNpmLock(dir: string, lockfiles: Map<string, string>): Map<string, string> {
  const result = new Map<string, string>();
  const prefix = dir === "." ? "" : `${dir}/`;
  const npmLock = lockfiles.get(`${prefix}package-lock.json`);
  if (npmLock) {
    try {
      const lock = JSON.parse(npmLock) as { packages?: Record<string, { version?: string }>; dependencies?: Record<string, { version?: string }> };
      if (lock.packages) {
        for (const [key, value] of Object.entries(lock.packages)) {
          const m = key.match(/^node_modules\/((?:@[^/]+\/)?[^/]+)$/);
          if (m && value.version) result.set(m[1]!, value.version);
        }
      } else if (lock.dependencies) {
        for (const [name, value] of Object.entries(lock.dependencies)) if (value.version) result.set(name, value.version);
      }
    } catch {
      // Unreadable lock; fall back to ranges.
    }
    return result;
  }
  const pnpmLock = lockfiles.get(`${prefix}pnpm-lock.yaml`);
  if (pnpmLock) {
    for (const m of pnpmLock.matchAll(/^\s{2}'?(@?[^\s'@:]+(?:\/[^\s'@:]+)?)@([0-9][^\s'(:]*)'?:\s*$/gm)) {
      if (!result.has(m[1]!)) result.set(m[1]!, m[2]!);
    }
    return result;
  }
  const yarnLock = lockfiles.get(`${prefix}yarn.lock`);
  if (yarnLock) {
    const blocks = yarnLock.split(/\n(?=\S)/);
    for (const block of blocks) {
      const head = block.match(/^"?((?:@[^/\s"]+\/)?[^@\s"]+)@/);
      const version = block.match(/\n\s+version:?\s+"?([^"\s]+)"?/);
      if (head && version && !result.has(head[1]!)) result.set(head[1]!, version[1]!);
    }
  }
  return result;
}

function parseRequirements(content: string, manifestPath: string): RawDependency[] {
  const out: RawDependency[] = [];
  for (const raw of content.split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line || line.startsWith("-")) continue;
    const m = line.match(/^([A-Za-z0-9_.-]+)(?:\[[^\]]*\])?\s*(.*)$/);
    if (!m) continue;
    const spec = m[2]!.trim();
    const pinned = spec.match(/==\s*([0-9][^\s,;]*)/);
    const version = pinned ? pinned[1]! : cleanVersion(spec);
    out.push({ ecosystem: "PyPI", name: m[1]!, version, declared: spec || "*", manifestPath, direct: true });
  }
  return out;
}

function parsePyproject(content: string, manifestPath: string): RawDependency[] {
  const out: RawDependency[] = [];
  const section = content.match(/\[project\][\s\S]*?dependencies\s*=\s*\[([\s\S]*?)\]/);
  if (section) {
    for (const m of section[1]!.matchAll(/["']([A-Za-z0-9_.-]+)(?:\[[^\]]*\])?\s*([^"']*)["']/g)) {
      out.push({ ecosystem: "PyPI", name: m[1]!, version: cleanVersion(m[2]!), declared: m[2]!.trim() || "*", manifestPath, direct: true });
    }
  }
  const poetry = content.match(/\[tool\.poetry\.dependencies\]([\s\S]*?)(?:\n\[|$)/);
  if (poetry) {
    for (const m of poetry[1]!.matchAll(/^([A-Za-z0-9_.-]+)\s*=\s*(?:"([^"]+)"|\{[^}]*version\s*=\s*"([^"]+)")/gm)) {
      if (m[1] === "python") continue;
      const spec = m[2] ?? m[3] ?? "*";
      out.push({ ecosystem: "PyPI", name: m[1]!, version: cleanVersion(spec), declared: spec, manifestPath, direct: true });
    }
  }
  return out;
}

function parsePipfile(content: string, manifestPath: string): RawDependency[] {
  const out: RawDependency[] = [];
  const section = content.match(/\[packages\]([\s\S]*?)(?:\n\[|$)/);
  if (!section) return out;
  for (const m of section[1]!.matchAll(/^([A-Za-z0-9_.-]+)\s*=\s*"([^"]*)"/gm)) {
    out.push({ ecosystem: "PyPI", name: m[1]!, version: cleanVersion(m[2]!), declared: m[2]!, manifestPath, direct: true });
  }
  return out;
}

function parseGoMod(content: string, manifestPath: string): RawDependency[] {
  const out: RawDependency[] = [];
  for (const m of content.matchAll(/^\s*([^\s/]+\.[^\s]+)\s+v([0-9][^\s]*)([^\n]*)$/gm)) {
    if (m[1] === "go" || m[1] === "module" || m[1]!.startsWith("//")) continue;
    out.push({ ecosystem: "Go", name: m[1]!, version: m[2]!, declared: `v${m[2]}`, manifestPath, direct: !/\/\/\s*indirect/.test(m[3] ?? "") });
  }
  return out;
}

function parseCargoToml(content: string, manifestPath: string): RawDependency[] {
  const out: RawDependency[] = [];
  for (const section of content.matchAll(/\[(?:dev-|build-)?dependencies\]([\s\S]*?)(?=\n\[|$)/g)) {
    for (const m of section[1]!.matchAll(/^([A-Za-z0-9_-]+)\s*=\s*(?:"([^"]+)"|\{[^}]*version\s*=\s*"([^"]+)")/gm)) {
      const spec = m[2] ?? m[3] ?? "*";
      out.push({ ecosystem: "crates.io", name: m[1]!, version: cleanVersion(spec), declared: spec, manifestPath, direct: true });
    }
  }
  return out;
}

async function parseGemfile(content: string, manifestPath: string, dir: string, root: string): Promise<RawDependency[]> {
  const locked = new Map<string, string>();
  try {
    const lock = await readFile(join(root, dir === "." ? "Gemfile.lock" : `${dir}/Gemfile.lock`), "utf8");
    for (const m of lock.matchAll(/^\s{4}([A-Za-z0-9_-]+) \(([^)]+)\)$/gm)) locked.set(m[1]!, m[2]!);
  } catch {
    // No lock.
  }
  const out: RawDependency[] = [];
  for (const m of content.matchAll(/^\s*gem\s+["']([^"']+)["'](?:\s*,\s*["']([^"']+)["'])?/gm)) {
    const spec = m[2] ?? "*";
    out.push({ ecosystem: "RubyGems", name: m[1]!, version: locked.get(m[1]!) ?? cleanVersion(spec), declared: spec, manifestPath, direct: true });
  }
  return out;
}

function parseComposer(content: string, manifestPath: string): RawDependency[] {
  const pkg = JSON.parse(content) as { require?: Record<string, string>; "require-dev"?: Record<string, string> };
  const out: RawDependency[] = [];
  for (const [name, spec] of Object.entries({ ...(pkg.require ?? {}), ...(pkg["require-dev"] ?? {}) })) {
    if (!name.includes("/")) continue; // php, ext-* are platform requirements
    out.push({ ecosystem: "Packagist", name, version: cleanVersion(spec), declared: spec, manifestPath, direct: true });
  }
  return out;
}

function parsePom(content: string, manifestPath: string): RawDependency[] {
  const out: RawDependency[] = [];
  const props = new Map<string, string>();
  for (const m of content.matchAll(/<([A-Za-z0-9_.-]+)>([^<]+)<\/\1>/g)) props.set(m[1]!, m[2]!.trim());
  for (const m of content.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
    const block = m[1]!;
    const groupId = block.match(/<groupId>([^<]+)<\/groupId>/)?.[1]?.trim();
    const artifactId = block.match(/<artifactId>([^<]+)<\/artifactId>/)?.[1]?.trim();
    let version = block.match(/<version>([^<]+)<\/version>/)?.[1]?.trim() ?? "";
    const prop = version.match(/^\$\{([^}]+)\}$/);
    if (prop) version = props.get(prop[1]!) ?? "";
    if (!groupId || !artifactId || !version) continue;
    out.push({ ecosystem: "Maven", name: `${groupId}:${artifactId}`, version: cleanVersion(version), declared: version, manifestPath, direct: true });
  }
  return out;
}

function parseCsproj(content: string, manifestPath: string): RawDependency[] {
  const out: RawDependency[] = [];
  for (const m of content.matchAll(/<PackageReference\s+Include="([^"]+)"\s+Version="([^"]+)"/g)) {
    out.push({ ecosystem: "NuGet", name: m[1]!, version: cleanVersion(m[2]!), declared: m[2]!, manifestPath, direct: true });
  }
  return out;
}

function parsePubspec(content: string, manifestPath: string): RawDependency[] {
  const out: RawDependency[] = [];
  for (const section of content.matchAll(/^(?:dev_)?dependencies:\s*\n((?:[ \t]+.*\n?)*)/gm)) {
    for (const m of section[1]!.matchAll(/^[ \t]+([A-Za-z0-9_]+):\s*(?:\^?([0-9][^\s]*))?\s*$/gm)) {
      if (m[1] === "flutter" || m[1] === "sdk") continue;
      out.push({ ecosystem: "Pub", name: m[1]!, version: m[2] ? cleanVersion(m[2]) : "*", declared: m[2] ?? "*", manifestPath, direct: true });
    }
  }
  return out;
}

function parseMixExs(content: string, manifestPath: string): RawDependency[] {
  const out: RawDependency[] = [];
  for (const m of content.matchAll(/\{:([a-z_0-9]+),\s*"([^"]+)"/g)) {
    out.push({ ecosystem: "Hex", name: m[1]!, version: cleanVersion(m[2]!), declared: m[2]!, manifestPath, direct: true });
  }
  return out;
}
