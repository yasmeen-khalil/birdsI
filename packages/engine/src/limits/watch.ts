import { z } from "zod";
import { tavily, type TavilyClient } from "@tavily/core";
import { VENDOR_LIMITS, type LimitsDrift } from "@birdsi/shared";
import type { ModelClient } from "../models/client";
import { toJsonSchema } from "../models/schema";

/**
 * The weekly watch over the pricing pages the checked limits list rests on.
 * Tavily fetches each page, code checks that every quoted sentence is still
 * on it, and when one is gone the large model says what the page states
 * now, as a proposal for a person to confirm. The list itself never changes
 * here: a wrong limit makes a wrong alert, so a person re-reads the page.
 */

export interface QuoteToCheck {
  label: string;
  quote: string;
}

/** Pages per Tavily extract call. */
export const PAGES_PER_CALL = 20;
/** Characters of a page the model sees when a quote is gone. */
export const PAGE_CHARS_FOR_MODEL = 40_000;
/** A page shorter than this is a block page or an error, not a pricing page, and counts as not read. */
export const MIN_PAGE_CHARS = 1_500;

/** An address as compared: no trailing slash, no fragment. */
function urlKey(url: string): string {
  return url.replace(/#.*$/, "").replace(/\/+$/, "");
}

/** Text as compared: one case, one kind of space, letters, digits and the signs prices use. */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[   ]/g, " ")
    .replace(/[^a-z0-9$%./ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The quotes a page no longer has. */
export function checkQuotes(pageText: string, quotes: QuoteToCheck[]): QuoteToCheck[] {
  const page = normalizeText(pageText);
  return quotes.filter((q) => !page.includes(normalizeText(q.quote)));
}

/** Every page and every quoted sentence per vendor, from the checked limits list. */
export function quotesByVendor(): Array<{ vendor: string; name: string; url: string; quotes: QuoteToCheck[] }> {
  const out: Array<{ vendor: string; name: string; url: string; quotes: QuoteToCheck[] }> = [];
  for (const v of VENDOR_LIMITS) {
    const byUrl = new Map<string, QuoteToCheck[]>();
    for (const tier of v.tiers) {
      for (const limit of tier.limits) byUrl.set(limit.source.url, [...(byUrl.get(limit.source.url) ?? []), { label: `${tier.name}: ${limit.label}`, quote: limit.source.quote }]);
      for (const condition of tier.conditions) byUrl.set(condition.source.url, [...(byUrl.get(condition.source.url) ?? []), { label: `${tier.name}: ${condition.text}`, quote: condition.source.quote }]);
    }
    if (byUrl.size === 0) byUrl.set(v.pricingUrl, []);
    for (const [url, quotes] of byUrl) out.push({ vendor: v.slug, name: v.name, url, quotes });
  }
  return out;
}

const Changes = z.object({
  changes: z.array(z.object({ was: z.string().max(300), now: z.string().max(300).nullable().describe("The sentence on the page that states the same limit or condition now, exactly as written, or null when the page no longer states it"), change: z.string().max(200).describe("What changed, in plain words") })).max(20),
});
const CHANGES_JSON_SCHEMA = toJsonSchema(Changes);

export const WATCH_SYSTEM = `You compare a vendor's current pricing page with sentences birdsI recorded from it earlier. For each recorded sentence that is no longer on the page, quote the sentence on the page that states the same limit or condition now, exactly as written, and say in plain words what changed. When the page no longer states it, say so and give null. Only the page text counts. Do not use emojis, em dashes, semicolons or exclamation marks.`;

export type ExtractPages = (urls: string[]) => Promise<{ pages: Map<string, string>; failed: Map<string, string> }>;

/** Tavily's extract, page text per address, with the addresses it could not fetch and why. */
export function tavilyExtract(apiKey: string): ExtractPages {
  const client: TavilyClient = tavily({ apiKey });
  return async (urls) => {
    const response = await client.extract(urls, { format: "text", extractDepth: "basic" });
    const pages = new Map(response.results.map((r) => [urlKey(r.url), r.rawContent]));
    const failed = new Map(response.failedResults.map((r) => [urlKey(r.url), r.error]));
    return { pages, failed };
  };
}

export interface WatchInput {
  extract: ExtractPages;
  /** The large model proposes what a page says now. Null leaves the proposal empty. */
  models: ModelClient | null;
  now?: Date;
  onProgress?: (done: number, total: number) => Promise<void> | void;
  /** A model failure for one page, said once. The row keeps its sentences gone and an empty proposal. */
  onWarn?: (message: string) => void;
}

export async function watchLimits(input: WatchInput): Promise<LimitsDrift[]> {
  const targets = quotesByVendor();
  const urls = [...new Set(targets.map((t) => t.url))];
  const pages = new Map<string, string>();
  const failed = new Map<string, string>();
  for (let i = 0; i < urls.length; i += PAGES_PER_CALL) {
    const batch = urls.slice(i, i + PAGES_PER_CALL);
    try {
      const got = await input.extract(batch);
      for (const [url, text] of got.pages) pages.set(urlKey(url), text);
      for (const [url, why] of got.failed) failed.set(urlKey(url), why);
    } catch (error) {
      for (const url of batch) failed.set(urlKey(url), error instanceof Error ? error.message.slice(0, 200) : String(error));
    }
    await input.onProgress?.(Math.min(i + PAGES_PER_CALL, urls.length), urls.length);
  }
  const checkedAt = (input.now ?? new Date()).toISOString();
  const out: LimitsDrift[] = [];
  for (const t of targets) {
    const page = pages.get(urlKey(t.url));
    if (page === undefined || page.length < MIN_PAGE_CHARS) {
      const why = page === undefined ? (failed.get(urlKey(t.url)) ?? "The page was not fetched.") : `The page came back nearly empty (${page.length} characters), so it was not read.`;
      out.push({ vendor: t.vendor, url: t.url, checkedAt, quotesTotal: t.quotes.length, missing: [], proposal: null, error: why });
      continue;
    }
    const missing = checkQuotes(page, t.quotes);
    let proposal: string | null = null;
    if (missing.length > 0 && input.models?.available) {
      try {
        const answer = await input.models.complete({
          tier: "super",
          purpose: "limits_watch",
          system: WATCH_SYSTEM,
          user: `Vendor: ${t.name}. Page: ${t.url}.\n\nRecorded sentences no longer found:\n${missing.map((m) => `- (${m.label}) ${m.quote}`).join("\n")}\n\nThe page now:\n${page.slice(0, PAGE_CHARS_FOR_MODEL)}`,
          schema: Changes,
          jsonSchema: CHANGES_JSON_SCHEMA,
          schemaName: "changes",
          maxOutputTokens: 3000,
        });
        proposal = answer.changes.map((c) => `${c.change}${c.now ? ` The page now says: ${c.now}` : " The page no longer states it."}`).join(" ") || null;
      } catch (error) {
        proposal = null;
        input.onWarn?.(`the model could not read ${t.url}: ${error instanceof Error ? error.message.slice(0, 160) : String(error)}`);
      }
    }
    out.push({ vendor: t.vendor, url: t.url, checkedAt, quotesTotal: t.quotes.length, missing, proposal, error: null });
  }
  return out;
}
