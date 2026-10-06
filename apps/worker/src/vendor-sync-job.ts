import {
  askQuestion,
  connectionsForUser,
  decryptSecret,
  expireAskedFacts,
  factsForVendors,
  knowledgeFor,
  markConnectionProbed,
  recordUsage,
  replaceFacts,
  resolveQuestionsByMetric,
  saveKnowledge,
  setVendorsSyncedAt,
  upsertFact,
  vendorsForRepo,
  type FactInput,
  type JobRow,
  type VendorRow,
} from "@birdsi/db";
import { CATALOG_BY_SLUG, CONNECTOR_BY_SLUG, knowledgeIsFresh, learnVendor, type ConnectorFact, type EngineConfig } from "@birdsi/engine";
import type { ProjectHints } from "@birdsi/shared";

/**
 * The ops stage. For every vendor of a repository: probe the connected
 * account, refresh the shared knowledge (what it is, its tiers) when stale,
 * read Stripe Projects data the CLI collected, and queue a question for the
 * owner wherever birdsI still cannot know the plan or the usage.
 */
export async function runVendorSyncJob(config: EngineConfig, job: JobRow, heartbeat: () => Promise<void>): Promise<void> {
  const repoId = String(job.payload["repoId"]);
  const ownerUserId = String(job.payload["ownerUserId"]);
  const hints = (job.payload["hints"] as ProjectHints | null | undefined) ?? null;
  const ticker = setInterval(() => void heartbeat().catch(() => {}), 15_000);
  try {
    const vendors = await vendorsForRepo(repoId);
    if (vendors.length === 0) {
      await setVendorsSyncedAt(repoId, new Date());
      return;
    }
    const connections = await connectionsForUser(ownerUserId);
    const bySlug = new Map(connections.map((c) => [c.vendor_slug, c]));
    const onUsage = (u: { purpose: string; model: string; inputTokens: number; outputTokens: number; costMicrodollars: number }) =>
      recordUsage({ ownerUserId, scanId: null, fixId: null, purpose: u.purpose, model: u.model, inputTokens: u.inputTokens, outputTokens: u.outputTokens, costMicrodollars: u.costMicrodollars });

    // 1. Shared knowledge: what each vendor is and its tiers, from current pricing pages.
    const knowledge = await knowledgeFor(vendors.map((v) => v.slug));
    for (const v of vendors) {
      const existing = knowledge.get(v.slug);
      if (knowledgeIsFresh(existing)) continue;
      try {
        const learned = await learnVendor(config, v.slug, v.name, [], { onUsage });
        if (learned) {
          await saveKnowledge(learned);
          knowledge.set(v.slug, learned);
        }
      } catch {
        // The pricing page may be unreachable today; the next sync tries again.
      }
    }

    // 2. Stripe Projects: plan and spend per provider, collected on the owner's machine.
    const projectFacts = stripeProjectFacts(hints);

    // 3. Connected accounts.
    for (const v of vendors) {
      const connector = CONNECTOR_BY_SLUG.get(v.slug);
      const connection = bySlug.get(v.slug);
      const fromProjects = projectFacts.get(v.slug) ?? [];
      let facts: ConnectorFact[] = [...fromProjects];
      if (connector && connection) {
        try {
          const token = decryptSecret(connection.token_ciphertext);
          const probed = await connector.probe(token, connection.settings ?? {});
          facts = mergeFacts(facts, probed);
          await markConnectionProbed(connection.id, "ok", null);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await markConnectionProbed(connection.id, "failed", message);
        }
      }
      await replaceFacts(v.id, "connector", facts.map((f) => ({ kind: f.kind, metric: f.metric, label: f.label, value: f.value, numeric: f.numeric, unit: f.unit, limitNumeric: f.limitNumeric, source: "connector", evidence: f.evidence ?? {} })));
      for (const f of facts) if (f.kind === "plan" || f.kind === "usage") await resolveQuestionsByMetric(repoId, v.id, f.metric);

      // 4. Docs facts: the limits of the plan the owner is on, from the tiers.
      await writeTierLimits(v, knowledge.get(v.slug));

      // 5. Typed usage older than a month is forgotten, then questions where birdsI still cannot know.
      await expireAskedFacts(v.id, 30);
      await queueQuestions(repoId, v, knowledge.get(v.slug), Boolean(connector), Boolean(connection));
    }
    await setVendorsSyncedAt(repoId, new Date());
  } finally {
    clearInterval(ticker);
  }
}

function mergeFacts(base: ConnectorFact[], extra: ConnectorFact[]): ConnectorFact[] {
  const out = new Map<string, ConnectorFact>();
  for (const f of base) out.set(f.metric, f);
  for (const f of extra) out.set(f.metric, f);
  return [...out.values()];
}

/** Reads the CLI's Stripe Projects status and spend output into facts per provider. */
function stripeProjectFacts(hints: ProjectHints | null): Map<string, ConnectorFact[]> {
  const out = new Map<string, ConnectorFact[]>();
  const sp = hints?.stripeProjects;
  if (!sp) return out;
  const push = (slug: string, f: ConnectorFact) => out.set(slug, [...(out.get(slug) ?? []), f]);
  const note = "From Stripe Projects on your machine.";
  const visit = (value: unknown, depth = 0) => {
    if (depth > 5 || !value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const v of value) visit(v, depth + 1);
      return;
    }
    const obj = value as Record<string, unknown>;
    const provider = typeof obj["provider"] === "string" ? obj["provider"].toLowerCase().split("/")[0]! : null;
    if (provider) {
      const tier = obj["tier"] ?? obj["plan"];
      if (typeof tier === "string" && tier.trim()) push(provider, { kind: "plan", metric: "plan", label: "Plan", value: tier, numeric: null, unit: null, limitNumeric: null, source: "connector", evidence: { note } });
      const spend = obj["spend"] ?? obj["amount"] ?? obj["total"];
      const spendNum = typeof spend === "number" ? spend : typeof spend === "string" && Number.isFinite(Number(spend)) ? Number(spend) : null;
      if (spendNum !== null) push(provider, { kind: "cost", metric: "spend_month", label: "Spend this month", value: `$${spendNum.toFixed(2)}`, numeric: spendNum, unit: "USD", limitNumeric: null, source: "connector", evidence: { note } });
      const limit = obj["spendLimit"] ?? obj["spend_limit"] ?? obj["limit"];
      const limitNum = typeof limit === "number" ? limit : null;
      if (limitNum !== null) push(provider, { kind: "limit", metric: "spend_limit", label: "Spend limit", value: `$${limitNum.toFixed(2)}`, numeric: limitNum, unit: "USD", limitNumeric: null, source: "connector", evidence: { note } });
    }
    for (const v of Object.values(obj)) if (v && typeof v === "object") visit(v, depth + 1);
  };
  visit(sp.state);
  visit(sp.status);
  visit(sp.spend);
  return out;
}

/** The limits of the plan the owner is on, as docs facts citing the pricing page. */
async function writeTierLimits(v: VendorRow, knowledge: Awaited<ReturnType<typeof knowledgeFor>> extends Map<string, infer K> ? K | undefined : never): Promise<void> {
  if (!knowledge || knowledge.tiers.length === 0) {
    await replaceFacts(v.id, "docs", []);
    return;
  }
  const facts = await factsForVendors([v.id]);
  const plan = facts.filter((f) => f.kind === "plan").sort((a, b) => sourceRank(a.source) - sourceRank(b.source))[0];
  const tier = plan ? knowledge.tiers.find((t) => t.name.toLowerCase() === plan.value.toLowerCase() || plan.value.toLowerCase().includes(t.name.toLowerCase())) : null;
  const source = knowledge.sources[0];
  if (!tier) {
    await replaceFacts(v.id, "docs", [{ kind: "status", metric: "tiers_known", label: "Plans", value: knowledge.tiers.map((t) => `${t.name}${t.priceUsd !== null ? ` ($${t.priceUsd}/mo)` : ""}`).join(", "), numeric: null, unit: null, limitNumeric: null, source: "docs", evidence: source ? { url: source.url } : {} }]);
    return;
  }
  const out: FactInput[] = tier.limits.map((l) => ({ kind: "limit" as const, metric: l.metric, label: l.label, value: l.amount !== null ? `${l.amount}${l.unit ? ` ${l.unit}` : ""}` : (l.note ?? "Included"), numeric: l.amount, unit: l.unit, limitNumeric: null, source: "docs" as const, evidence: source ? { url: source.url, ...(l.note ? { note: l.note } : {}) } : {} }));
  if (tier.priceUsd !== null) out.push({ kind: "cost", metric: "plan_price", label: "Plan price", value: `$${tier.priceUsd}/month`, numeric: tier.priceUsd, unit: "USD", limitNumeric: null, source: "docs", evidence: source ? { url: source.url } : {} });
  await replaceFacts(v.id, "docs", out);
  // Pair usage facts with their limits so alerts can compute a ratio.
  const usage = facts.filter((f) => f.kind === "usage" && f.numeric !== null && f.limit_numeric === null);
  for (const u of usage) {
    const match = tier.limits.find((l) => l.amount !== null && (l.metric === u.metric || l.metric.replace(/_month$|monthly_/g, "") === u.metric.replace(/_month$|monthly_/g, "")));
    if (match) await upsertFact(v.id, { kind: u.kind, metric: u.metric, label: u.label, value: `${u.value} of ${match.amount}${match.unit ? ` ${match.unit}` : ""}`, numeric: u.numeric, unit: u.unit, limitNumeric: match.amount, source: u.source, evidence: u.evidence });
  }
}

function sourceRank(source: string): number {
  return { connector: 0, asked: 1, docs: 2, static: 3, estimate: 4 }[source] ?? 5;
}

async function queueQuestions(repoId: string, v: VendorRow, knowledge: { tiers: Array<{ name: string; limits: Array<{ metric: string; label: string; amount: number | null; unit: string | null }> }> } | undefined, hasConnector: boolean, isConnected: boolean): Promise<void> {
  const facts = await factsForVendors([v.id]);
  const hasPlan = facts.some((f) => f.kind === "plan");
  const entry = CATALOG_BY_SLUG.get(v.slug);
  if (entry?.planless) return;
  if (!hasPlan && knowledge && knowledge.tiers.length > 0) {
    await askQuestion(repoId, {
      vendorId: v.id,
      askedBy: "birdsi",
      question: `Which ${v.name} plan is this app on?`,
      why: hasConnector && !isConnected ? `birdsI can read this itself once ${v.name} is connected in Settings. Until then it needs your answer to watch the plan's limits.` : `${v.name} does not report the plan through its API, and the plan decides which limits birdsI watches for you.`,
      options: knowledge.tiers.map((t) => t.name),
      lookupUrl: entry?.dashboardUrl ?? null,
      updates: { kind: "plan", metric: "plan", label: "Plan", unit: null },
      key: `plan:${v.slug}`,
    });
  }
  // Usage: when no connector can read it and the plan has a counted limit, ask for the number.
  const plan = facts.filter((f) => f.kind === "plan").sort((a, b) => sourceRank(a.source) - sourceRank(b.source))[0];
  const tier = plan && knowledge ? knowledge.tiers.find((t) => t.name.toLowerCase() === plan.value.toLowerCase() || plan.value.toLowerCase().includes(t.name.toLowerCase())) : null;
  const hasUsage = facts.some((f) => f.kind === "usage" && f.source === "connector");
  if (tier && !hasUsage && !(hasConnector && isConnected)) {
    const primary = tier.limits.find((l) => l.amount !== null && /request|credit|email|message|user|token|build|minute|gb|storage|band/i.test(`${l.metric} ${l.label}`));
    if (primary) {
      await askQuestion(repoId, {
        vendorId: v.id,
        askedBy: "birdsi",
        question: `How much of the ${v.name} ${primary.label.toLowerCase()} limit has the app used this month?`,
        why: hasConnector ? `Connect ${v.name} in Settings and birdsI reads this itself. Until then, the number from the dashboard keeps the limit alert honest.` : `${v.name} has no API for usage, so the number from its dashboard is the only way birdsI can warn you before the limit of ${primary.amount}${primary.unit ? ` ${primary.unit}` : ""} is reached.`,
        options: [],
        lookupUrl: entry?.dashboardUrl ?? null,
        updates: { kind: "usage", metric: primary.metric, label: primary.label, unit: primary.unit },
        key: `usage:${v.slug}:${primary.metric}`,
      });
    }
  }
}
