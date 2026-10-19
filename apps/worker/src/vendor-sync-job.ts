import { decryptSecret, expireAskedFacts, factsForVendors, keysForRepo, markConnectionProbed, replaceFacts, repoWithInstallation, setVendorsSyncedAt, vendorsForRepo, type FactInput, type JobRow } from "@birdsi/db";
import { CONNECTOR_BY_SLUG, MAX_VENDORS_PER_SCAN, settingsForProject, type ConnectorFact, type EngineConfig } from "@birdsi/engine";
import { planReads } from "./read-plan";
import { bestFacts, LIMITS_BY_SLUG, tierFor, type FactSource, type ProjectHints } from "@birdsi/shared";

/** One sync holds the only worker while it runs, so it stops starting new vendors after this long. */
const SYNC_BUDGET_MS = 10 * 60_000;

/**
 * The read of the accounts. For every vendor of a repository: read the
 * connected account, and read the Stripe Projects data the CLI collected.
 * No model is called and nothing is asked: what birdsI cannot read, it says
 * it could not read.
 */
export async function runVendorSyncJob(_config: EngineConfig, job: JobRow, heartbeat: () => Promise<void>): Promise<void> {
  // Each key reads its own project of this app; a vendor with no tied key is read with the owner's untied key, the old way.
  const repoId = String(job.payload["repoId"]);
  const ownerUserId = String(job.payload["ownerUserId"]);
  const hints = (job.payload["hints"] as ProjectHints | null | undefined) ?? null;
  const ticker = setInterval(() => void heartbeat().catch(() => {}), 15_000);
  const deadline = Date.now() + SYNC_BUDGET_MS;
  try {
    // Lists stored before the per-scan cap existed can be longer; the sync reads no more than a scan keeps.
    const vendors = (await vendorsForRepo(repoId)).slice(0, MAX_VENDORS_PER_SCAN);
    if (vendors.length === 0) {
      await setVendorsSyncedAt(repoId, new Date());
      return;
    }
    const { repo } = await repoWithInstallation(repoId);
    const keys = await keysForRepo({ id: repo.id, owner_user_id: ownerUserId, full_name: repo.full_name });
    const allKeys = new Map([...keys.tied, ...keys.untied].map((k) => [k.id, k]));
    const plan = planReads(
      vendors.map((v) => ({ id: v.id, slug: v.slug })),
      keys.projects.map((p) => ({ id: p.id, vendor: p.vendor, kind: p.kind, ref: p.ref, label: p.label, settings: p.settings ?? {} })),
      keys.tied,
      keys.untied,
      (slug) => CONNECTOR_BY_SLUG.has(slug),
    );

    // Stripe Projects: plan and spend per provider, collected on the owner's machine.
    const projectFacts = stripeProjectFacts(hints);

    for (const v of vendors) {
      if (Date.now() > deadline) break;
      const connector = CONNECTOR_BY_SLUG.get(v.slug);
      let facts: ConnectorFact[] = [...(projectFacts.get(v.slug) ?? [])];
      for (const target of plan.filter((t) => t.vendorId === v.id)) {
        const key = allKeys.get(target.connectionId);
        if (!connector || !key) continue;
        const settings = target.project ? settingsForProject(target.project) : ((key.settings ?? {}) as Record<string, string>);
        try {
          const probed = await connector.probe(decryptSecret(key.token_ciphertext), settings);
          facts = mergeFacts(facts, target.suffix ? probed.map((f) => ({ ...f, metric: `${f.metric}:${target.suffix}`, label: `${f.label} (${target.suffix})` })) : probed);
          await markConnectionProbed(key.id, "ok", null);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await markConnectionProbed(key.id, "failed", message);
        }
      }
      await replaceFacts(v.id, "connector", facts.map((f) => ({ kind: f.kind, metric: f.metric, label: f.label, value: f.value, numeric: f.numeric, unit: f.unit, limitNumeric: f.limitNumeric, source: "connector", evidence: f.evidence ?? {} })));
      // Usage the owner typed before v3 goes stale after a month; nothing asks for it again.
      await expireAskedFacts(v.id, 30);
      // The plan's limits from the checked list. This also replaces the tiers a model read from pricing pages before v3.
      await replaceFacts(v.id, "docs", await checkedLimitFacts(v.id, v.slug));
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

/** The checked limits of the plan the account is on, as facts citing the vendor's own page and the date it was read. */
async function checkedLimitFacts(vendorId: string, slug: string): Promise<FactInput[]> {
  const limits = LIMITS_BY_SLUG.get(slug);
  if (!limits) return [];
  const facts = (await factsForVendors([vendorId])).filter((f) => f.source !== "docs").map((f) => ({ metric: f.metric, kind: f.kind, value: f.value, source: f.source as FactSource }));
  const plan = bestFacts(facts).find((f) => f.kind === "plan");
  const tier = plan ? tierFor(limits, plan.value) : null;
  if (!tier) return [];
  const checked = `Checked against ${limits.name}'s page on ${limits.verifiedOn}.`;
  return tier.limits.map((l) => ({
    kind: "limit" as const,
    metric: `limit_${l.metric}`,
    label: `${l.label}, ${tier.name} plan`,
    value: `${l.amount.toLocaleString("en-US")} ${l.unit}`,
    numeric: l.amount,
    unit: l.unit,
    limitNumeric: null,
    source: "docs" as const,
    evidence: { url: l.source.url, excerpt: l.source.quote, note: checked },
  }));
}
