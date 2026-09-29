import semver from "semver";
import { findingKey, type Ecosystem, type FindingDraft } from "@birdsi/shared";
import type { Check, CheckContext } from "./types";

/**
 * Latest published version per dependency, from deps.dev where it covers the
 * ecosystem and from the registry otherwise. Being several major versions
 * behind is a Proven fact; whether it matters is left to severity.
 */
const DEPS_DEV_SYSTEMS: Partial<Record<Ecosystem, string>> = {
  npm: "npm",
  PyPI: "pypi",
  Go: "go",
  "crates.io": "cargo",
  Maven: "maven",
  RubyGems: "rubygems",
  NuGet: "nuget",
};

export const freshnessCheck: Check = {
  id: "freshness",
  step: "dependencies",
  label: "Comparing each package with its latest release",
  tiers: ["light", "deep", "audit"],
  available: () => true,
  async run(ctx: CheckContext): Promise<FindingDraft[]> {
    const findings: FindingDraft[] = [];
    const deps = ctx.dependencies;
    let done = 0;
    const queue = deps.slice();
    const workers = Array.from({ length: 6 }, async () => {
      while (queue.length > 0 && !ctx.signal.aborted) {
        const dep = queue.shift()!;
        dep.latestVersion = await latestVersion(dep.ecosystem, dep.name, ctx.signal);
        done += 1;
        if (done % 10 === 0 || done === deps.length) await ctx.emit({ type: "step_progress", step: "dependencies", done, total: deps.length });
      }
    });
    await Promise.all(workers);

    for (const dep of deps) {
      if (!dep.latestVersion || !dep.direct) continue;
      const inUse = semver.coerce(dep.versionInUse);
      const latest = semver.coerce(dep.latestVersion);
      if (!inUse || !latest) continue;
      const majorsBehind = latest.major - inUse.major;
      if (majorsBehind < 2) continue;
      findings.push({
        key: findingKey({ checkId: "freshness", path: dep.manifestPath, subject: `${dep.ecosystem}:${dep.name}` }),
        checkId: "freshness",
        title: `${dep.name} is ${majorsBehind} major versions behind`,
        explanation: `${dep.manifestPath} uses ${dep.name} ${dep.versionInUse}. The latest release is ${dep.latestVersion}. Each major version can change behaviour, so the gap grows harder to cross the longer it waits.`,
        whyItMatters: "Old major versions stop receiving security fixes, and current documentation and AI coding tools describe the new API, which leads to code that does not match what is installed.",
        severity: majorsBehind >= 4 ? "medium" : "low",
        confidence: "proven",
        category: "dependency",
        location: { path: dep.manifestPath },
        evidence: { advisories: [], rule: `Latest version from the package registry is ${dep.latestVersion}` },
        actionKind: "steps",
        steps: [
          { title: `Read the ${dep.name} upgrade guide`, detail: "Major versions usually have a migration guide listing breaking changes." },
          { title: "Upgrade one major version at a time", detail: "Run your tests after each step so a break points at one change." },
        ],
        fixPlan: null,
      });
    }
    return findings;
  },
};

const latestCache = new Map<string, Promise<string | null>>();

export async function latestVersion(ecosystem: Ecosystem, name: string, signal: AbortSignal): Promise<string | null> {
  const key = `${ecosystem}:${name}`;
  if (!latestCache.has(key)) latestCache.set(key, lookup(ecosystem, name, signal));
  return latestCache.get(key)!;
}

async function lookup(ecosystem: Ecosystem, name: string, signal: AbortSignal): Promise<string | null> {
  try {
    const system = DEPS_DEV_SYSTEMS[ecosystem];
    if (system) {
      const url = `https://api.deps.dev/v3/systems/${system}/packages/${encodeURIComponent(name)}`;
      const response = await fetch(url, { signal });
      if (response.ok) {
        const data = (await response.json()) as { versions?: Array<{ versionKey: { version: string }; isDefault?: boolean }> };
        const def = data.versions?.find((v) => v.isDefault)?.versionKey.version;
        if (def) return def.replace(/^v/, "");
      }
    }
    if (ecosystem === "npm") {
      const response = await fetch(`https://registry.npmjs.org/${name}/latest`, { signal });
      if (response.ok) return ((await response.json()) as { version?: string }).version ?? null;
    }
    if (ecosystem === "PyPI") {
      const response = await fetch(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`, { signal });
      if (response.ok) return ((await response.json()) as { info?: { version?: string } }).info?.version ?? null;
    }
    if (ecosystem === "Packagist") {
      const response = await fetch(`https://repo.packagist.org/p2/${name}.json`, { signal });
      if (response.ok) {
        const data = (await response.json()) as { packages?: Record<string, Array<{ version: string }>> };
        const versions = data.packages?.[name] ?? [];
        const stable = versions.map((v) => v.version.replace(/^v/, "")).filter((v) => semver.valid(semver.coerce(v)) && !/(alpha|beta|rc|dev)/i.test(v));
        return stable[0] ?? null;
      }
    }
    if (ecosystem === "Hex") {
      const response = await fetch(`https://hex.pm/api/packages/${encodeURIComponent(name)}`, { signal });
      if (response.ok) return ((await response.json()) as { latest_stable_version?: string }).latest_stable_version ?? null;
    }
    if (ecosystem === "Pub") {
      const response = await fetch(`https://pub.dev/api/packages/${encodeURIComponent(name)}`, { signal });
      if (response.ok) return ((await response.json()) as { latest?: { version?: string } }).latest?.version ?? null;
    }
  } catch {
    // Network problems are not findings.
  }
  return null;
}
