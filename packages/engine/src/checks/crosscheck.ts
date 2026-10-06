import type { FindingDraft } from "@birdsi/shared";
import { filterModelFindings, MODEL_FINDINGS_JSON_SCHEMA, ModelFindings, REVIEW_VOICE, toDraft } from "./model-findings";
import { errorMessage, isBudget } from "./review";
import type { Check, CheckContext } from "./types";

const SYSTEM = `You are birdsI, looking across a whole codebase for contradictions and gaps that no single file shows. ${REVIEW_VOICE}

You are given facts extracted from the repository: environment variables the code reads versus the ones documented, routes and handlers, database tables and the code that uses them, what the README promises, and the findings already established.

Report:
- Contradictions: the README or comments promise something the code does not do; two modules disagree about a rule (for example, one enforces a limit and another ignores it); a schema and the code that reads it disagree.
- Gaps: an environment variable the code needs but nothing documents; a route that exists but is never protected while its siblings are; a table with no access rules while others have them; a payment or email path with no failure handling.
- Inconsistencies: the same concept handled two different ways.

Only report what the facts show. Cite the paths involved. If the facts show nothing, return no findings.`;

/**
 * The cross-file pass. Deterministic extraction feeds the model a set of
 * facts; the model connects them. Judgment class.
 */
export const crosscheckCheck: Check = {
  id: "crosscheck",
  step: "crosscheck",
  label: "Comparing files against each other for contradictions",
  tiers: ["deep", "audit"],
  available: () => true,
  async run(ctx: CheckContext): Promise<FindingDraft[]> {
    if (!ctx.budget.crosscheckModel) return [];
    const knownPaths = new Set(ctx.inventory.files.map((f) => f.path));
    const facts = await extractFacts(ctx);
    try {
      const result = await ctx.models.complete({
        tier: ctx.budget.crosscheckModel,
        fast: false,
        purpose: "crosscheck",
        system: SYSTEM,
        cachedContext: `Repository overview:\n${ctx.digest.text}`,
        user: `Facts:\n${facts}\n\nFindings already established:\n${ctx.findingsSoFar
          .slice(0, 40)
          .map((f) => `- [${f.confidence}] ${f.title}${f.location ? ` (${f.location.path})` : ""}`)
          .join("\n")}`,
        schema: ModelFindings,
        jsonSchema: MODEL_FINDINGS_JSON_SCHEMA,
        schemaName: "findings",
        maxOutputTokens: 4000,
        signal: ctx.signal,
      });
      const drafts: FindingDraft[] = [];
      for (const f of filterModelFindings(result.findings, 0.6, knownPaths)) {
        const draft = toDraft("crosscheck", f, { confidence: "judgment" });
        drafts.push(draft);
        await ctx.emit({ type: "finding", finding: { ...draft, id: draft.key } });
      }
      return drafts;
    } catch (error) {
      if (!isBudget(error)) await ctx.note(`The cross-file pass could not finish: ${errorMessage(error)}`);
      return [];
    }
  },
};

async function extractFacts(ctx: CheckContext): Promise<string> {
  const sections: string[] = [];
  const envRead = new Map<string, Set<string>>();
  const envDocumented = new Set<string>();
  const routes: string[] = [];
  const tables = new Set<string>();
  let readme = "";

  for (const file of ctx.inventory.files) {
    if (file.bytes > 200_000) continue;
    const name = file.path.split("/").pop() ?? "";
    if (/^readme\.md$/i.test(file.path)) readme = (await ctx.read(file.path)).slice(0, 3000);
    if (name === ".env.example" || name === ".env.sample" || name === ".env.template") {
      for (const m of (await ctx.read(file.path)).matchAll(/^\s*([A-Z][A-Z0-9_]+)\s*=/gm)) envDocumented.add(m[1]!);
    }
    if (!/\.(ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|php|java|kt|cs|ex|exs)$/.test(file.path)) continue;
    if (!ctx.filesToRead.some((f) => f.path === file.path) && file.bytes > 60_000) continue;
    const content = await ctx.read(file.path);
    for (const m of content.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)|os\.environ(?:\.get)?\(?\[?["']([A-Z][A-Z0-9_]+)["']|ENV\[["']([A-Z][A-Z0-9_]+)["']\]|os\.Getenv\("([A-Z][A-Z0-9_]+)"\)|env::var\("([A-Z][A-Z0-9_]+)"\)|getenv\(["']([A-Z][A-Z0-9_]+)["']\)/g)) {
      const key = m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? m[6];
      if (!key) continue;
      const set = envRead.get(key) ?? new Set();
      set.add(file.path);
      envRead.set(key, set);
    }
    if (/(^|\/)(api|routes?)\//.test(file.path) || /route\.[tj]s$/.test(file.path)) {
      const methods = [...content.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]);
      const hasAuth = /auth\(|getAuth|requireAuth|currentUser|getServerSession|verifyToken|authenticate|Authorization/i.test(content);
      routes.push(`${file.path}${methods.length ? ` [${methods.join(", ")}]` : ""}${hasAuth ? " (auth check present)" : " (no auth check in file)"}`);
    }
    for (const m of content.matchAll(/\.from\(["']([a-z_][a-z0-9_]*)["']\)|(?:prisma|db)\.([a-z][A-Za-z0-9_]*)\.(?:findMany|findFirst|findUnique|create|update|delete|upsert)\(/g)) {
      tables.add(m[1] ?? m[2] ?? "");
    }
  }
  tables.delete("");

  const undocumented = [...envRead.keys()].filter((k) => !envDocumented.has(k) && !/^(NODE_ENV|VERCEL|CI|PORT|HOME|PATH|NEXT_PUBLIC_VERCEL)/.test(k));
  const unused = [...envDocumented].filter((k) => !envRead.has(k));
  sections.push(`Environment variables read by code but not documented in .env.example (${undocumented.length}): ${undocumented.slice(0, 40).map((k) => `${k} (${[...envRead.get(k)!].slice(0, 2).join(", ")})`).join("; ") || "none"}`);
  sections.push(`Environment variables documented but never read (${unused.length}): ${unused.slice(0, 40).join(", ") || "none"}`);
  sections.push(`Route and handler files (${routes.length}):\n${routes.slice(0, 80).join("\n") || "none found"}`);
  sections.push(`Database tables or models referenced in code: ${[...tables].slice(0, 60).join(", ") || "none found"}`);
  const migrations = ctx.inventory.files.filter((f) => /(^|\/)(migrations?|supabase\/migrations)\//.test(f.path)).map((f) => f.path);
  if (migrations.length > 0) {
    let rlsNotes: string[] = [];
    for (const path of migrations.slice(0, 30)) {
      const sql = await ctx.read(path);
      const created = [...sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gi)].map((m) => m[1]!);
      const rls = [...sql.matchAll(/alter\s+table\s+(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s+enable\s+row\s+level\s+security/gi)].map((m) => m[1]!);
      for (const t of created) rlsNotes.push(`${t}: created in ${path}${rls.includes(t) ? ", RLS enabled" : ", RLS not enabled in the same file"}`);
    }
    rlsNotes = rlsNotes.slice(0, 40);
    sections.push(`Tables from migrations:\n${rlsNotes.join("\n") || "none parsed"}`);
  }
  if (readme) sections.push(`README (first part):\n${readme}`);
  return sections.join("\n\n");
}
