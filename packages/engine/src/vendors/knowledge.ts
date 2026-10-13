import { tavily } from "@tavily/core";
import { z } from "zod";
import type { PlanTier, VendorDraft, VendorKnowledge } from "@birdsi/shared";
import type { EngineConfig } from "../config";
import { ModelClient, type BeforeCall, type UsageSink } from "../models/client";
import { toJsonSchema } from "../models/schema";
import { REVIEW_VOICE } from "../checks/model-findings";
import type { RepoDigest } from "../scan/digest";
import { CATALOG_BY_SLUG } from "./catalog";

/**
 * Two model-assisted tasks around vendors. Both are cheap (the small model)
 * and both are honest about where they got their facts.
 *
 * 1. labelPurposes: what this app uses each vendor for, from the call sites.
 * 2. learnVendor: what a vendor is and its plan tiers, from its current
 *    pricing page found through Tavily. Cached by the caller.
 */

const Purposes = z.object({
  purposes: z.array(z.object({ slug: z.string(), purpose: z.string().max(240) })),
});
const PURPOSES_SCHEMA = toJsonSchema(Purposes);

export async function labelPurposes(models: ModelClient, drafts: VendorDraft[], digest: RepoDigest, signal?: AbortSignal): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (drafts.length === 0) return out;
  const items = drafts.slice(0, 40).map((d) => {
    const sites = d.callSites.slice(0, 6).map((c) => `  ${c.path}:${c.line}  ${c.excerpt}`).join("\n");
    return `- ${d.slug} (${d.name}): detected by ${d.detectedBy.join(", ")}${d.packages.length ? `; packages ${d.packages.join(", ")}` : ""}${d.envVars.length ? `; env ${d.envVars.slice(0, 6).join(", ")}` : ""}\n${sites || "  (no call sites)"}`;
  });
  const result = await models.complete({
    tier: "nano",
    fast: true,
    purpose: "vendor-purposes",
    system: `You are birdsI, describing what an application uses each outside service for. ${REVIEW_VOICE}\n\nFor every service listed, write one short sentence saying what this app uses it for, based only on the file paths and code lines given. Say "Purpose not clear from the code" when the evidence does not show it. Never invent features.`,
    user: `Repository overview:\n${digest.text}\n\nServices:\n${items.join("\n")}`,
    schema: Purposes,
    jsonSchema: PURPOSES_SCHEMA,
    schemaName: "purposes",
    maxOutputTokens: 3000,
    ...(signal ? { signal } : {}),
  });
  for (const p of result.purposes) if (drafts.some((d) => d.slug === p.slug)) out.set(p.slug, p.purpose.trim());
  return out;
}

const Learned = z.object({
  what: z.string().max(240).describe("What the service is, one sentence for someone who has never heard of it"),
  tiers: z
    .array(
      z.object({
        name: z.string().max(60),
        priceUsd: z.number().nullable().describe("Monthly price in US dollars; null when usage-based or custom"),
        priceNote: z.string().max(160).nullable().describe("How it is billed when not a flat monthly price"),
        limits: z
          .array(
            z.object({
              metric: z.string().max(40).describe("snake_case metric name, for example monthly_requests, db_size_gb, monthly_active_users"),
              label: z.string().max(60),
              amount: z.number().nullable(),
              unit: z.string().max(24).nullable(),
              note: z.string().max(160).nullable(),
            }),
          )
          .max(12),
      }),
    )
    .max(8),
  sourceUrls: z.array(z.string()).max(6).describe("Only URLs from the documents you were given that the tiers rest on"),
});
const LEARNED_SCHEMA = toJsonSchema(Learned);

export interface LearnOptions {
  onUsage?: UsageSink;
  beforeCall?: BeforeCall;
  signal?: AbortSignal;
}

/** Reads a vendor's current pricing page and returns what it is and its tiers, with the sources. */
export async function learnVendor(config: EngineConfig, slug: string, name: string, hintDomains: string[] = [], options: LearnOptions = {}): Promise<VendorKnowledge | null> {
  if (!config.tavilyApiKey) return null;
  const entry = CATALOG_BY_SLUG.get(slug);
  const client = tavily({ apiKey: config.tavilyApiKey });
  const queries = entry?.pricingUrl ? [`${name} pricing plans limits`, `${name} free tier limits`] : [`${name} API pricing plans ${hintDomains[0] ?? ""}`.trim(), `what is ${name} developer API`];
  const docs = new Map<string, { url: string; title: string; content: string; publishedAt?: string }>();
  for (const query of queries) {
    if (options.signal?.aborted) break;
    try {
      const result = await client.search(query, { searchDepth: "basic", maxResults: 4, includeAnswer: false, ...(entry?.pricingUrl ? { includeDomains: [new URL(entry.pricingUrl).hostname.replace(/^www\./, "")] } : {}) });
      for (const r of result.results) if (!docs.has(r.url)) docs.set(r.url, { url: r.url, title: r.title, content: r.content, ...(r.publishedDate ? { publishedAt: r.publishedDate } : {}) });
    } catch {
      // One query failing is fine; the other may land.
    }
  }
  if (entry?.pricingUrl) {
    try {
      const extracted = await client.extract([entry.pricingUrl], {});
      for (const r of extracted.results) if (!docs.has(r.url)) docs.set(r.url, { url: r.url, title: `${name} pricing`, content: r.rawContent });
    } catch {
      // Search results may still carry the tiers.
    }
  }
  if (docs.size === 0) return null;
  const models = new ModelClient(config, { ...(options.onUsage ? { onUsage: options.onUsage } : {}), ...(options.beforeCall ? { beforeCall: options.beforeCall } : {}) });
  const list = [...docs.values()];
  const learned = await models.complete({
    tier: "nano",
    fast: true,
    purpose: "vendor-knowledge",
    system: `You are birdsI, reading a vendor's current pricing and documentation pages. ${REVIEW_VOICE}\n\nFrom the documents only, describe what the service is and list its plan tiers with their monthly price and the limits each tier includes (requests, storage, users, credits, bandwidth, seats). Use null for anything the documents do not state. Do not guess from memory. List only the URLs of documents you actually used.`,
    user: `Service: ${name} (${slug}).\n\nDocuments:\n${list.map((d, i) => `[${i + 1}] ${d.title}\nURL: ${d.url}${d.publishedAt ? `\nPublished: ${d.publishedAt}` : ""}\n${d.content.slice(0, 6000)}`).join("\n\n")}`,
    schema: Learned,
    jsonSchema: LEARNED_SCHEMA,
    schemaName: "vendor",
    maxOutputTokens: 4000,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const allowed = new Set(list.map((d) => d.url));
  const sources = learned.sourceUrls.filter((u) => allowed.has(u)).map((u) => {
    const d = docs.get(u)!;
    return { url: d.url, title: d.title, ...(d.publishedAt ? { publishedAt: d.publishedAt } : {}) };
  });
  // One tier per name; the model sometimes repeats a tier per billing period.
  const seen = new Set<string>();
  const tiers: PlanTier[] = learned.tiers
    .filter((t) => {
      const key = t.name.trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((t) => ({ name: t.name.trim(), priceUsd: t.priceUsd, priceNote: t.priceNote, limits: t.limits }));
  return {
    slug,
    name,
    what: learned.what || entry?.what || "",
    pricingUrl: entry?.pricingUrl ?? sources[0]?.url ?? null,
    tiers,
    sources: sources.length > 0 ? sources : list.slice(0, 2).map((d) => ({ url: d.url, title: d.title, ...(d.publishedAt ? { publishedAt: d.publishedAt } : {}) })),
    fetchedAt: new Date().toISOString(),
  };
}

/** Knowledge is refreshed after this many days, so tiers never go stale quietly. */
export const KNOWLEDGE_TTL_DAYS = 7;

export function knowledgeIsFresh(k: VendorKnowledge | undefined): boolean {
  if (!k) return false;
  return Date.now() - new Date(k.fetchedAt).getTime() < KNOWLEDGE_TTL_DAYS * 86_400_000;
}
