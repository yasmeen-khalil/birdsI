import { tavily, type TavilyClient } from "@tavily/core";
import { findingKey, type Dependency, type FindingDraft } from "@birdsi/shared";
import { filterModelFindings, MODEL_FINDINGS_JSON_SCHEMA, ModelFindings, REVIEW_VOICE, toDraft } from "./model-findings";
import { errorMessage, isBudget } from "./review";
import type { Check, CheckContext } from "./types";

const SYSTEM = `You are birdsI, comparing how an application uses a package with what the package's current official documentation says. ${REVIEW_VOICE}

You are given: the package and version in use, excerpts of current documents found on the web (each with a URL), and the places in the code that use the package.

Report a finding only when a document you were given shows one of these, and the code is affected:
- the API the code calls is deprecated, removed or renamed in the version in use or the latest version;
- a security advisory or breaking change applies to the version in use;
- the documented recommended setup differs from the code in a way that causes a real problem (not style).

For every finding, set docUrl to the exact URL of the document it rests on and docQuote to the exact passage. If no document supports a problem, return no findings. Do not guess from memory; only the documents provided count.`;

interface DocHit {
  url: string;
  title: string;
  content: string;
  publishedAt?: string;
}

/**
 * Current docs, changelogs and advisories per dependency through Tavily. The
 * model's comparison only counts as Doc-verified when it cites one of the
 * documents it was given, quote included.
 */
export const docsCheck: Check = {
  id: "docs",
  step: "docs",
  label: "Checking packages against their current documentation",
  tiers: ["light", "deep", "audit"],
  available: (config) => config.tavilyApiKey !== null,
  async run(ctx: CheckContext): Promise<FindingDraft[]> {
    if (!ctx.config.tavilyApiKey) return [];
    const client = tavily({ apiKey: ctx.config.tavilyApiKey });
    const findings: FindingDraft[] = [];
    const knownPaths = new Set(ctx.inventory.files.map((f) => f.path));
    const candidates = pickDependencies(ctx, ctx.budget.maxDocsChecks);
    await ctx.emit({ type: "step_started", step: "docs", label: docsCheck.label, total: candidates.length });
    let done = 0;
    for (const dep of candidates) {
      if (ctx.signal.aborted) break;
      try {
        const hits = await searchDocs(client, dep, ctx.signal);
        const usage = await findUsage(ctx, dep);
        const now = new Date().toISOString();
        if (hits.length === 0) {
          dep.docsCheck = { status: "unknown", note: "No current documentation was found for this package.", checkedAt: now };
        } else {
          const allowed = new Map(hits.map((h) => [h.url, { title: h.title, ...(h.publishedAt ? { publishedAt: h.publishedAt } : {}) }]));
          const result = await ctx.models.complete({
            tier: "nano",
            fast: ctx.budget.fast,
            purpose: "docs",
            system: SYSTEM,
            user: [
              `Package: ${dep.name} (${dep.ecosystem}), version in use ${dep.versionInUse}${dep.latestVersion ? `, latest ${dep.latestVersion}` : ""}. Declared in ${dep.manifestPath}.`,
              `Documents:\n${hits.map((h, i) => `[${i + 1}] ${h.title}\nURL: ${h.url}${h.publishedAt ? `\nPublished: ${h.publishedAt}` : ""}\n${h.content.slice(0, 1800)}`).join("\n\n")}`,
              `Where the code uses it:\n${usage || "(no direct imports found; the package may be used indirectly)"}`,
            ].join("\n\n"),
            schema: ModelFindings,
            jsonSchema: MODEL_FINDINGS_JSON_SCHEMA,
            schemaName: "findings",
            maxOutputTokens: 2000,
            signal: ctx.signal,
          });
          const kept = filterModelFindings(result.findings, 0.6, knownPaths).filter((f) => f.docUrl && allowed.has(f.docUrl) && f.docQuote);
          const first = hits[0]!;
          dep.docsCheck = {
            status: kept.length > 0 ? (kept.some((f) => /deprecat|removed|no longer/i.test(f.title + f.explanation)) ? "deprecated" : "behind") : "current",
            ...(kept.length > 0 ? { note: kept[0]!.title } : {}),
            doc: { url: first.url, title: first.title, excerpt: first.content.slice(0, 240), ...(first.publishedAt ? { publishedAt: first.publishedAt } : {}) },
            checkedAt: now,
          };
          for (const f of kept) {
            if (!f.path) f.path = dep.manifestPath;
            f.category = f.category === "security" ? "security" : "docs";
            const draft = toDraft("docs", f, { confidence: "doc_verified", allowedDocs: allowed });
            draft.key = findingKey({ checkId: "docs", path: dep.manifestPath, subject: `${dep.name}:${f.title}` });
            findings.push(draft);
            await ctx.emit({ type: "finding", finding: { ...draft, id: draft.key } });
          }
        }
      } catch (error) {
        if (isBudget(error)) break;
        await ctx.note(`Docs check skipped for ${dep.name}: ${errorMessage(error)}`);
      }
      done += 1;
      await ctx.emit({ type: "step_progress", step: "docs", done, total: candidates.length });
    }
    return findings;
  },
};

/** Frameworks and services first, then the most used direct dependencies. */
function pickDependencies(ctx: CheckContext, max: number): Dependency[] {
  const direct = ctx.dependencies.filter((d) => d.direct);
  const score = (d: Dependency): number => {
    let s = 0;
    if (/^(next|react|vue|nuxt|svelte|astro|express|fastify|hono|django|flask|fastapi|rails|laravel)/i.test(d.name.split("/").pop() ?? "")) s += 50;
    if (/(supabase|prisma|drizzle|clerk|auth|stripe|openai|anthropic|firebase|mongoose|sequelize|typeorm)/i.test(d.name)) s += 40;
    if (d.vulnerabilities.length > 0) s += 30;
    if (d.latestVersion && d.latestVersion.split(".")[0] !== d.versionInUse.split(".")[0]) s += 20;
    if (/^@types\//.test(d.name) || /(eslint|prettier|typescript|vitest|jest|tailwind|postcss)/i.test(d.name)) s -= 40;
    return s;
  };
  return direct
    .map((d) => ({ d, s: score(d) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, max)
    .map((x) => x.d);
}

async function searchDocs(client: TavilyClient, dep: Dependency, signal: AbortSignal): Promise<DocHit[]> {
  const major = dep.versionInUse.split(".")[0];
  const queries = [
    `${dep.name} ${dep.ecosystem} ${major ? `v${major}` : ""} breaking changes deprecated migration guide`.replace(/\s+/g, " "),
    `${dep.name} security advisory ${new Date().getFullYear()}`,
  ];
  const hits = new Map<string, DocHit>();
  for (const query of queries) {
    if (signal.aborted) break;
    const result = await client.search(query, { searchDepth: "basic", maxResults: 4, timeRange: "year", includeAnswer: false });
    for (const r of result.results) {
      if (!hits.has(r.url)) {
        hits.set(r.url, { url: r.url, title: r.title, content: r.content, ...(r.publishedDate ? { publishedAt: r.publishedDate } : {}) });
      }
    }
  }
  return [...hits.values()].slice(0, 6);
}

/** Import lines and a little context, so the model sees how the package is called. */
async function findUsage(ctx: CheckContext, dep: Dependency): Promise<string> {
  const short = dep.name.split("/").pop() ?? dep.name;
  const needle = new RegExp(`(from\\s+['"]${escape(dep.name)}|require\\(['"]${escape(dep.name)}|import\\s+${escape(short)}\\b|^\\s*(import|from)\\s+${escape(short.replace(/-/g, "_"))}\\b)`, "m");
  const snippets: string[] = [];
  for (const file of ctx.filesToRead) {
    if (snippets.length >= 5) break;
    const content = await ctx.read(file.path);
    const lines = content.split("\n");
    const idx = lines.findIndex((l) => needle.test(l));
    if (idx === -1) continue;
    const window = lines.slice(Math.max(0, idx - 2), Math.min(lines.length, idx + 12)).join("\n");
    snippets.push(`${file.path}:${idx + 1}\n${window}`);
  }
  return snippets.join("\n\n");
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
