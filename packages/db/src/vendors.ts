import type { FactKind, FactSource, PlanTier, Vendor, VendorDraft, VendorFact, VendorKnowledge } from "@birdsi/shared";
import { getDb, unwrap } from "./client";

export interface VendorRow {
  id: string;
  repo_id: string;
  scan_id: string | null;
  slug: string;
  name: string;
  category: Vendor["category"];
  what: string;
  purpose: string | null;
  detected_by: Vendor["detectedBy"];
  packages: string[];
  env_vars: string[];
  call_sites: Vendor["callSites"];
  pricing_url: string | null;
  docs_url: string | null;
  connectable: boolean;
  updated_at: string;
}

export interface VendorFactRow {
  id: string;
  vendor_id: string;
  kind: FactKind;
  metric: string;
  label: string;
  value: string;
  numeric: number | null;
  unit: string | null;
  limit_numeric: number | null;
  source: FactSource;
  evidence: VendorFact["evidence"];
  observed_at: string;
}

export function toFact(row: VendorFactRow): VendorFact {
  return {
    id: row.id,
    vendorId: row.vendor_id,
    kind: row.kind,
    metric: row.metric,
    label: row.label,
    value: row.value,
    numeric: row.numeric,
    unit: row.unit,
    limitNumeric: row.limit_numeric,
    source: row.source,
    evidence: row.evidence ?? {},
    observedAt: row.observed_at,
  };
}

export function toVendor(row: VendorRow, facts: VendorFactRow[], connected: boolean): Vendor {
  return {
    id: row.id,
    repoId: row.repo_id,
    slug: row.slug,
    name: row.name,
    category: row.category,
    what: row.what,
    purpose: row.purpose,
    detectedBy: row.detected_by ?? [],
    packages: row.packages ?? [],
    envVars: row.env_vars ?? [],
    callSites: row.call_sites ?? [],
    pricingUrl: row.pricing_url,
    docsUrl: row.docs_url,
    connectable: row.connectable,
    connected,
    facts: facts.map(toFact),
    updatedAt: row.updated_at,
  };
}

/**
 * Replaces the vendor list of a repository with what the latest scan found.
 * Vendors that disappeared from the code are removed with their facts;
 * vendors that stayed keep their id, so questions and facts survive scans.
 */
export async function replaceVendors(repoId: string, scanId: string, drafts: VendorDraft[]): Promise<VendorRow[]> {
  const db = getDb();
  const slugs = drafts.map((d) => d.slug);
  if (slugs.length > 0) {
    const { error: delError } = await db.from("vendors").delete().eq("repo_id", repoId).not("slug", "in", `(${slugs.map((s) => `"${s}"`).join(",")})`);
    if (delError) throw new Error(`replaceVendors delete: ${delError.message}`);
  } else {
    const { error: delError } = await db.from("vendors").delete().eq("repo_id", repoId);
    if (delError) throw new Error(`replaceVendors delete all: ${delError.message}`);
    return [];
  }
  const rows = drafts.map((d) => ({
    repo_id: repoId,
    scan_id: scanId,
    slug: d.slug,
    name: d.name,
    category: d.category,
    what: d.what,
    purpose: d.purpose,
    detected_by: d.detectedBy,
    packages: d.packages,
    env_vars: d.envVars,
    call_sites: d.callSites,
    pricing_url: d.pricingUrl,
    docs_url: d.docsUrl,
    connectable: d.connectable,
    updated_at: new Date().toISOString(),
  }));
  const result = await db.from("vendors").upsert(rows, { onConflict: "repo_id,slug" }).select();
  const stored = unwrap(result, "replaceVendors") as VendorRow[];
  // Static facts come from the scan and are replaced with it.
  const ids = stored.map((v) => v.id);
  const { error: factError } = await db.from("vendor_facts").delete().in("vendor_id", ids).eq("source", "static");
  if (factError) throw new Error(`replaceVendors facts: ${factError.message}`);
  return stored;
}

export async function vendorsForRepo(repoId: string): Promise<VendorRow[]> {
  const db = getDb();
  const { data, error } = await db.from("vendors").select().eq("repo_id", repoId).order("name");
  if (error) throw new Error(`vendorsForRepo: ${error.message}`);
  return (data ?? []) as VendorRow[];
}

export async function vendorBySlug(repoId: string, slug: string): Promise<VendorRow | null> {
  const db = getDb();
  const { data, error } = await db.from("vendors").select().eq("repo_id", repoId).eq("slug", slug).maybeSingle();
  if (error) throw new Error(`vendorBySlug: ${error.message}`);
  return (data as VendorRow | null) ?? null;
}

export async function factsForVendors(vendorIds: string[]): Promise<VendorFactRow[]> {
  if (vendorIds.length === 0) return [];
  const db = getDb();
  const { data, error } = await db.from("vendor_facts").select().in("vendor_id", vendorIds).order("observed_at", { ascending: false });
  if (error) throw new Error(`factsForVendors: ${error.message}`);
  return (data ?? []) as VendorFactRow[];
}

export interface FactInput {
  kind: FactKind;
  metric: string;
  label: string;
  value: string;
  numeric: number | null;
  unit: string | null;
  limitNumeric: number | null;
  source: FactSource;
  evidence?: VendorFact["evidence"];
}

export interface FactObservation {
  metric: string;
  numeric: number;
  limit_numeric: number | null;
  observed_at: string;
}

/** Appends usage observations so runway can be computed from the rate. */
export async function recordFactHistory(vendorId: string, facts: FactInput[]): Promise<void> {
  const rows = facts.filter((f) => f.kind === "usage" && f.numeric !== null).map((f) => ({ vendor_id: vendorId, metric: f.metric, numeric: f.numeric, limit_numeric: f.limitNumeric }));
  if (rows.length === 0) return;
  const db = getDb();
  const { error } = await db.from("vendor_fact_history").insert(rows);
  if (error) throw new Error(`recordFactHistory: ${error.message}`);
}

export async function factHistory(vendorIds: string[], days = 60): Promise<Map<string, FactObservation[]>> {
  const out = new Map<string, FactObservation[]>();
  if (vendorIds.length === 0) return out;
  const db = getDb();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data, error } = await db.from("vendor_fact_history").select("vendor_id, metric, numeric, limit_numeric, observed_at").in("vendor_id", vendorIds).gte("observed_at", since).order("observed_at");
  if (error) throw new Error(`factHistory: ${error.message}`);
  for (const r of (data ?? []) as Array<FactObservation & { vendor_id: string }>) out.set(r.vendor_id, [...(out.get(r.vendor_id) ?? []), r]);
  return out;
}

/** Writes facts from one source for one vendor, replacing that source's earlier facts. */
export async function replaceFacts(vendorId: string, source: FactSource, facts: FactInput[]): Promise<void> {
  const db = getDb();
  const { error: delError } = await db.from("vendor_facts").delete().eq("vendor_id", vendorId).eq("source", source);
  if (delError) throw new Error(`replaceFacts delete: ${delError.message}`);
  if (source === "connector" || source === "asked") await recordFactHistory(vendorId, facts);
  if (facts.length === 0) return;
  const rows = facts.map((f) => ({
    vendor_id: vendorId,
    kind: f.kind,
    metric: f.metric,
    label: f.label,
    value: f.value,
    numeric: f.numeric,
    unit: f.unit,
    limit_numeric: f.limitNumeric,
    source,
    evidence: f.evidence ?? {},
    observed_at: new Date().toISOString(),
  }));
  const { error } = await db.from("vendor_facts").upsert(rows, { onConflict: "vendor_id,metric,source" });
  if (error) throw new Error(`replaceFacts: ${error.message}`);
}

/** Adds or updates one fact without touching the rest of its source. */
export async function upsertFact(vendorId: string, fact: FactInput): Promise<void> {
  const db = getDb();
  const { error } = await db.from("vendor_facts").upsert(
    {
      vendor_id: vendorId,
      kind: fact.kind,
      metric: fact.metric,
      label: fact.label,
      value: fact.value,
      numeric: fact.numeric,
      unit: fact.unit,
      limit_numeric: fact.limitNumeric,
      source: fact.source,
      evidence: fact.evidence ?? {},
      observed_at: new Date().toISOString(),
    },
    { onConflict: "vendor_id,metric,source" },
  );
  if (error) throw new Error(`upsertFact: ${error.message}`);
}

export async function setVendorPurpose(vendorId: string, purpose: string | null): Promise<void> {
  const db = getDb();
  const { error } = await db.from("vendors").update({ purpose, updated_at: new Date().toISOString() }).eq("id", vendorId);
  if (error) throw new Error(`setVendorPurpose: ${error.message}`);
}

export async function setVendorsSyncedAt(repoId: string, at: Date | null): Promise<void> {
  const db = getDb();
  const { error } = await db.from("repos").update({ vendors_synced_at: at ? at.toISOString() : null }).eq("id", repoId);
  if (error) throw new Error(`setVendorsSyncedAt: ${error.message}`);
}

// Shared knowledge

export async function knowledgeFor(slugs: string[]): Promise<Map<string, VendorKnowledge>> {
  const out = new Map<string, VendorKnowledge>();
  if (slugs.length === 0) return out;
  const db = getDb();
  const { data, error } = await db.from("vendor_knowledge").select().in("slug", slugs);
  if (error) throw new Error(`knowledgeFor: ${error.message}`);
  for (const r of (data ?? []) as Array<Record<string, unknown>>) {
    out.set(r["slug"] as string, {
      slug: r["slug"] as string,
      name: r["name"] as string,
      what: r["what"] as string,
      pricingUrl: (r["pricing_url"] as string | null) ?? null,
      tiers: (r["tiers"] as PlanTier[]) ?? [],
      sources: (r["sources"] as VendorKnowledge["sources"]) ?? [],
      fetchedAt: r["fetched_at"] as string,
    });
  }
  return out;
}

export async function saveKnowledge(k: VendorKnowledge): Promise<void> {
  const db = getDb();
  const { error } = await db.from("vendor_knowledge").upsert({ slug: k.slug, name: k.name, what: k.what, pricing_url: k.pricingUrl, tiers: k.tiers, sources: k.sources, fetched_at: k.fetchedAt }, { onConflict: "slug" });
  if (error) throw new Error(`saveKnowledge: ${error.message}`);
}
