import { alertsForApp, latestLimitsWatch, recordUsage, alertsAvailable, decryptSecret, deadlinesForApp, entriesForApp, expireAskedFacts, factsForVendors, keysForRepo, latestServiceMap, markConnectionProbed, readsAvailable, replaceFacts, repoWithInstallation, saveProjectRead, setAlertEmail, setVendorsSyncedAt, syncAlerts, toVendor, userById, vendorsForRepo, type FactInput, type JobRow } from "@birdsi/db";
import { explainFailure, failedProduction, ModelClient, appAlerts, CONNECTOR_BY_SLUG, MAX_VENDORS_PER_SCAN, readProject, settingsForProject, type ConnectorFact, type EngineConfig } from "@birdsi/engine";
import { emailEnv, sendAlertEmail } from "./alert-email";
import { planReads } from "./read-plan";
import { spendHook } from "./spend";
import { bestFacts, LIMITS_BY_SLUG, projectDashboardUrl, readParts, readsInDepth, tierFor, type FactSource, type ProjectHints, type ProjectReadData } from "@birdsi/shared";

/** One sync holds the only worker while it runs, so it stops starting new vendors after this long. */
const SYNC_BUDGET_MS = 10 * 60_000;

/**
 * The read of the accounts. For every vendor of a repository: read the
 * connected account, and read the Stripe Projects data the CLI collected.
 * The small model explains a failed deployment from the error lines the
 * provider kept, never the code. Nothing is asked: what birdsI cannot read, it says
 * it could not read.
 */
export async function runVendorSyncJob(config: EngineConfig, job: JobRow, heartbeat: () => Promise<void>): Promise<void> {
  // Each key reads its own project of this app; a vendor with no tied key is read with the owner's untied key, the old way.
  const repoId = String(job.payload["repoId"]);
  const ownerUserId = String(job.payload["ownerUserId"]);
  const hints = (job.payload["hints"] as ProjectHints | null | undefined) ?? null;
  const ticker = setInterval(() => void heartbeat().catch(() => {}), 15_000);
  const deadline = Date.now() + SYNC_BUDGET_MS;
  try {
    // Lists stored before the per-scan cap existed can be longer; the sync reads no more than a scan keeps.
    const vendors = (await vendorsForRepo(repoId)).slice(0, MAX_VENDORS_PER_SCAN);
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

    // In depth: each Vercel project, Supabase project and OneSignal app of the app that has a key,
    // read part by part and kept dated. The map says which migrations the database should have.
    const map = keys.app ? ((await latestServiceMap(repo.id).catch(() => null))?.map ?? null) : null;
    const readsNow = new Map<string, ProjectReadData>();
    if (keys.app && (await readsAvailable())) {
      for (const project of keys.projects.filter((p) => readsInDepth(p.vendor, p.kind))) {
        if (Date.now() > deadline) break;
        const key = keys.tied.find((k) => k.app_project_id === project.id);
        if (!key) continue;
        const data = await readProject({ vendor: project.vendor, kind: project.kind, ref: project.ref, label: project.label, settings: project.settings ?? {} }, decryptSecret(key.token_ciphertext), map, { now: new Date() });
        if (!data) continue;
        await saveProjectRead({ appId: keys.app.id, projectId: project.id, data });
        readsNow.set(project.id, data);
        // The key's state follows the read: it failed only when no part of the project could be read.
        const parts = readParts(data);
        const failed = parts.filter((p) => !p.reading.ok);
        if (failed.length === parts.length) {
          const first = failed[0]!.reading;
          await markConnectionProbed(key.id, "failed", first.ok ? null : first.reason);
        } else {
          await markConnectionProbed(key.id, "ok", null);
        }
      }
    }

    // The alert stream: what this read found, opened, refreshed or closed, and emailed when it is new.
    if (keys.app && (await alertsAvailable())) {
      const app = keys.app;
      const facts = await factsForVendors(vendors.map((v) => v.id));
      const withFacts = vendors.map((v) => toVendor(v, facts.filter((f) => f.vendor_id === v.id), true));
      // A failed production deployment explained in plain words by the small model, once per failure: an open alert that already carries one is reused.
      const explanations = new Map<string, { text: string; model: string }>();
      const spend = spendHook(ownerUserId);
      const models = new ModelClient(config, { beforeCall: spend.beforeCall, onUsage: (u) => recordUsage({ ownerUserId, scanId: null, purpose: u.purpose, model: u.model, inputTokens: u.inputTokens, outputTokens: u.outputTokens, costMicrodollars: u.costMicrodollars }) });
      if (models.available) {
        const open = await alertsForApp(app.id).catch(() => []);
        for (const project of keys.projects.filter((p) => p.vendor === "vercel" && p.kind === "project")) {
          const read = readsNow.get(project.id);
          if (!read || read.vendor !== "vercel") continue;
          const failure = failedProduction(read);
          if (!failure) continue;
          const prior = open.find((a) => !a.resolvedAt && a.kind === "deployment_failed" && a.details["deploymentId"] === failure.deployment.id && typeof a.details["explanation"] === "string");
          if (prior) {
            explanations.set(project.id, { text: String(prior.details["explanation"]), model: String(prior.details["explainedBy"] ?? models.modelId("nano")) });
            continue;
          }
          try {
            explanations.set(project.id, await explainFailure(models, { project: project.label ?? project.ref, ...failure }));
          } catch (error) {
            console.error(`[worker] could not explain the failed deployment of ${project.ref}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
      const slugs = new Set(vendors.map((v) => v.slug));
      const drift = (await latestLimitsWatch().catch(() => [])).filter((d) => slugs.has(d.vendor));
      const { drafts, checked } = appAlerts({
        drift,
        explanations,
        app: { name: app.name, environments: app.environments },
        projects: keys.projects.map((p) => ({ id: p.id, vendor: p.vendor, kind: p.kind, ref: p.ref, label: p.label, plan: p.plan, dashboardUrl: projectDashboardUrl({ vendor: p.vendor, kind: p.kind, ref: p.ref, settings: p.settings ?? {} }) })),
        map,
        reads: readsNow,
        vendors: withFacts,
        // The dates to watch, and every renewal the owner entered by hand, which warns the same way.
        deadlines: [...(await deadlinesForApp(app.id)), ...(await entriesForApp(app.id)).filter((e) => e.renewsOn).map((e) => ({ id: e.id, appId: e.appId, vendor: e.vendor, label: `${e.label} renews`, dueOn: e.renewsOn!, note: e.note, createdAt: e.createdAt }))],
        now: new Date(),
      });
      const opened = await syncAlerts(app.id, drafts, checked);
      if (opened.length > 0) {
        const owner = await userById(ownerUserId);
        const { status, sentAt } = await sendAlertEmail(emailEnv(), { email: owner?.email ?? null, email_updates: owner?.email_updates ?? false }, { name: app.name, repoId: repo.id }, opened);
        await setAlertEmail(opened.map((a) => a.id), status, sentAt);
      }
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
