import { findingKey, type Dependency, type FindingDraft, type Severity, type Vulnerability } from "@birdsi/shared";
import type { RawDependency } from "../inventory/manifests";
import type { Check, CheckContext } from "./types";

const OSV_BATCH = "https://api.osv.dev/v1/querybatch";
const OSV_VULN = "https://api.osv.dev/v1/vulns/";

interface OsvBatchResponse {
  results: Array<{ vulns?: Array<{ id: string; modified: string }> }>;
}

interface OsvVuln {
  id: string;
  aliases?: string[];
  summary?: string;
  details?: string;
  severity?: Array<{ type: string; score: string }>;
  database_specific?: { severity?: string };
  affected?: Array<{
    package?: { name: string; ecosystem: string };
    ranges?: Array<{ type: string; events: Array<{ introduced?: string; fixed?: string }> }>;
  }>;
}

/**
 * Known vulnerabilities from OSV for every dependency, in every ecosystem.
 * OSV established the fact, so each finding is Proven.
 */
export const vulnerabilitiesCheck: Check = {
  id: "vulnerabilities",
  step: "vulnerabilities",
  label: "Checking every package against the OSV vulnerability database",
  available: () => true,
  async run(ctx: CheckContext): Promise<FindingDraft[]> {
    const deps = ctx.rawDependencies.filter((d) => /^\d/.test(d.version));
    if (deps.length === 0) return [];
    const byDep = new Map<RawDependency, Vulnerability[]>();

    for (let i = 0; i < deps.length; i += 500) {
      if (ctx.signal.aborted) break;
      const batch = deps.slice(i, i + 500);
      const body = { queries: batch.map((d) => ({ version: d.version, package: { name: d.name, ecosystem: d.ecosystem } })) };
      const response = await fetch(OSV_BATCH, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: ctx.signal });
      if (!response.ok) {
        await ctx.note(`The vulnerability database did not answer (HTTP ${response.status}), so ${batch.length} packages were not checked for vulnerabilities.`);
        continue;
      }
      const data = (await response.json()) as OsvBatchResponse;
      await ctx.emit({ type: "step_progress", step: "vulnerabilities", done: Math.min(i + 500, deps.length), total: deps.length });
      for (let j = 0; j < batch.length; j++) {
        const ids = (data.results[j]?.vulns ?? []).map((v) => v.id);
        if (ids.length === 0) continue;
        const details = await Promise.all(ids.slice(0, 8).map((id) => fetchVuln(id, ctx.signal)));
        const dep = batch[j]!;
        byDep.set(dep, details.filter((v): v is Vulnerability => v !== null).map((v) => v));
      }
    }

    // Enrich the shared dependency list.
    for (const dep of ctx.dependencies) {
      const raw = deps.find((d) => d.ecosystem === dep.ecosystem && d.name === dep.name && d.manifestPath === dep.manifestPath);
      if (raw && byDep.has(raw)) dep.vulnerabilities = byDep.get(raw)!;
    }

    const findings: FindingDraft[] = [];
    for (const [dep, vulns] of byDep) {
      if (vulns.length === 0) continue;
      const worst = vulns.reduce((a, b) => (severityRank(a.severity) <= severityRank(b.severity) ? a : b));
      const fixedIn = vulns.map((v) => v.fixedIn).filter((v): v is string => v !== null).sort(compareVersionsDesc)[0] ?? null;
      const explanation = `${dep.name} ${dep.version} (${dep.ecosystem}, declared in ${dep.manifestPath}) has ${vulns.length === 1 ? "a known vulnerability" : `${vulns.length} known vulnerabilities`}. The most serious: ${worst.summary}`;
      findings.push({
        key: findingKey({ checkId: "vulnerabilities", path: dep.manifestPath, subject: `${dep.ecosystem}:${dep.name}` }),
        checkId: "vulnerabilities",
        title: `${dep.name} ${dep.version} has ${vulns.length === 1 ? "a known vulnerability" : `${vulns.length} known vulnerabilities`}`,
        explanation,
        whyItMatters: worst.severity === "critical" || worst.severity === "high"
          ? "Attackers scan public code for exactly these versions. A published vulnerability with a known fix is the easiest way in."
          : "The problem is documented publicly, so it is worth closing even if the impact is limited.",
        severity: worst.severity,
        confidence: "proven",
        category: "dependency",
        location: { path: dep.manifestPath },
        evidence: {
          advisories: vulns.map((v) => v.id),
          doc: { url: worst.url, title: worst.id, excerpt: worst.summary },
          rule: "Version match in the OSV database",
        },
        actionKind: fixedIn ? "fix" : "steps",
        steps: fixedIn
          ? []
          : [{ title: `Watch for a fixed release of ${dep.name}`, detail: "No fixed version is published yet. Check whether the vulnerable code path is one your app uses, and consider an alternative package." }],
        fixPlan: fixedIn
          ? { summary: `Update ${dep.name} from ${dep.version} to ${fixedIn} or later in ${dep.manifestPath}.`, paths: [dep.manifestPath], followUp: ["Reinstall dependencies and run your tests after the update."] }
          : null,
      });
    }
    return findings;
  },
};

const vulnCache = new Map<string, Promise<Vulnerability | null>>();

async function fetchVuln(id: string, signal: AbortSignal): Promise<Vulnerability | null> {
  if (!vulnCache.has(id)) {
    vulnCache.set(
      id,
      (async () => {
        try {
          const response = await fetch(OSV_VULN + encodeURIComponent(id), { signal });
          if (!response.ok) return null;
          const v = (await response.json()) as OsvVuln;
          return {
            id: v.id,
            aliases: v.aliases ?? [],
            summary: (v.summary ?? v.details?.split("\n")[0] ?? "No description provided.").slice(0, 300),
            severity: severityFromOsv(v),
            fixedIn: fixedVersion(v),
            url: `https://osv.dev/vulnerability/${encodeURIComponent(v.id)}`,
          };
        } catch {
          return null;
        }
      })(),
    );
  }
  return vulnCache.get(id)!;
}

function severityFromOsv(v: OsvVuln): Severity {
  const label = v.database_specific?.severity?.toUpperCase();
  if (label === "CRITICAL") return "critical";
  if (label === "HIGH") return "high";
  if (label === "MODERATE" || label === "MEDIUM") return "medium";
  if (label === "LOW") return "low";
  const cvss = v.severity?.find((s) => s.type.startsWith("CVSS"))?.score;
  if (cvss) {
    const base = cvssBase(cvss);
    if (base >= 9) return "critical";
    if (base >= 7) return "high";
    if (base >= 4) return "medium";
    return "low";
  }
  return "medium";
}

/** Approximates a CVSS 3.x base score from the vector when only the vector is given. */
function cvssBase(vector: string): number {
  const parts = Object.fromEntries(vector.split("/").map((p) => p.split(":") as [string, string]));
  const av = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 }[parts["AV"] ?? "N"] ?? 0.85;
  const ac = { L: 0.77, H: 0.44 }[parts["AC"] ?? "L"] ?? 0.77;
  const scopeChanged = parts["S"] === "C";
  const pr = parts["PR"] === "N" ? 0.85 : parts["PR"] === "L" ? (scopeChanged ? 0.68 : 0.62) : scopeChanged ? 0.5 : 0.27;
  const ui = parts["UI"] === "N" ? 0.85 : 0.62;
  const cia = (k: string) => ({ H: 0.56, L: 0.22, N: 0 }[parts[k] ?? "N"] ?? 0);
  const iss = 1 - (1 - cia("C")) * (1 - cia("I")) * (1 - cia("A"));
  const impact = scopeChanged ? 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15) : 6.42 * iss;
  const exploit = 8.22 * av * ac * pr * ui;
  if (impact <= 0) return 0;
  const score = scopeChanged ? Math.min(1.08 * (impact + exploit), 10) : Math.min(impact + exploit, 10);
  return Math.ceil(score * 10) / 10;
}

function fixedVersion(v: OsvVuln): string | null {
  const fixed: string[] = [];
  for (const affected of v.affected ?? []) {
    for (const range of affected.ranges ?? []) {
      for (const event of range.events) if (event.fixed) fixed.push(event.fixed);
    }
  }
  return fixed.sort(compareVersionsDesc)[0] ?? null;
}

function severityRank(s: Severity): number {
  return { critical: 0, high: 1, medium: 2, low: 3 }[s];
}

export function compareVersionsDesc(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pb[i] ?? 0) - (pa[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function toDependency(raw: RawDependency): Dependency {
  return {
    ecosystem: raw.ecosystem,
    name: raw.name,
    versionInUse: raw.version,
    latestVersion: null,
    manifestPath: raw.manifestPath,
    direct: raw.direct,
    vulnerabilities: [],
    docsCheck: null,
  };
}
