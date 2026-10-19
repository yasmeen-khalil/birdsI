import type { FactKind, FactSource, Vendor, VendorDraft, VendorFact } from "@birdsi/shared";
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
  // Slugs go into a hand-built filter below, so anything outside [a-z0-9-] is refused here.
  const unsafe = drafts.find((d) => !/^[a-z0-9-]{1,40}$/.test(d.slug));
  if (unsafe) throw new Error(`replaceVendors: refusing vendor slug ${JSON.stringify(unsafe.slug.slice(0, 60))}`);
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

/** Usage the owner typed goes stale; after the window it is removed so the question is asked again. */
export async function expireAskedFacts(vendorId: string, days = 30): Promise<number> {
  const db = getDb();
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data, error } = await db.from("vendor_facts").delete().eq("vendor_id", vendorId).eq("source", "asked").eq("kind", "usage").lt("observed_at", cutoff).select("id");
  if (error) throw new Error(`expireAskedFacts: ${error.message}`);
  return ((data ?? []) as unknown[]).length;
}

/** Repositories whose vendors have not been synced within the window and that have been scanned at least once. */
export async function reposDueForSync(hours: number, limit: number): Promise<Array<{ id: string; owner_user_id: string }>> {
  const db = getDb();
  const cutoff = new Date(Date.now() - hours * 3_600_000).toISOString();
  const { data, error } = await db.from("repos").select("id, owner_user_id, vendors_synced_at").is("archived_at", null).or(`vendors_synced_at.is.null,vendors_synced_at.lt.${cutoff}`).limit(limit);
  if (error) throw new Error(`reposDueForSync: ${error.message}`);
  const rows = (data ?? []) as Array<{ id: string; owner_user_id: string; vendors_synced_at: string | null }>;
  const due: Array<{ id: string; owner_user_id: string }> = [];
  for (const r of rows) {
    const { count } = await db.from("vendors").select("id", { count: "exact", head: true }).eq("repo_id", r.id);
    if ((count ?? 0) > 0) due.push({ id: r.id, owner_user_id: r.owner_user_id });
  }
  return due;
}
