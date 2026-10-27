import { describe, expect, it } from "vitest";
import type { ModelClient } from "../models/client";
import { checkQuotes, normalizeText, quotesByVendor, watchLimits } from "./watch";

describe("the limits watch", () => {
  it("compares sentences one case and one space at a time", () => {
    expect(normalizeText("  Hobby:  1 cron job,  once a day! ")).toBe("hobby 1 cron job once a day");
    const quotes = [
      { label: "Hobby: crons", quote: "1 cron job that runs once a day" },
      { label: "Hobby: bandwidth", quote: "100 GB fast data transfer" },
    ];
    expect(checkQuotes("Plans. Hobby includes 1 CRON JOB that runs once a day and 100 gb Fast Data Transfer.", quotes)).toEqual([]);
    expect(checkQuotes("Plans. Hobby includes 2 cron jobs that run twice a day and 100 GB fast data transfer.", quotes).map((q) => q.label)).toEqual(["Hobby: crons"]);
  });

  it("knows every page and every quoted sentence of the checked limits list", () => {
    const targets = quotesByVendor();
    expect(targets.length).toBeGreaterThan(10);
    expect(targets.some((t) => t.vendor === "vercel" && t.quotes.length > 0)).toBe(true);
    for (const t of targets) for (const q of t.quotes) expect(q.quote.length).toBeGreaterThan(5);
  });

  it("reads every page once, reports the sentences gone with the model's proposal, and says which pages it could not fetch", async () => {
    const targets = quotesByVendor();
    const vercel = targets.find((t) => t.vendor === "vercel" && t.quotes.length > 0)!;
    const dropped = vercel.quotes[0]!;
    const calls: string[][] = [];
    const extract = async (urls: string[]) => {
      calls.push(urls);
      const pages = new Map<string, string>();
      const failed = new Map<string, string>();
      for (const url of urls) {
        if (url === "https://documentation.onesignal.com/docs/en/billing-faq") {
          failed.set(url, "HTTP 403");
          continue;
        }
        const quotes = targets.filter((t) => t.url === url).flatMap((t) => t.quotes.map((q) => q.quote));
        if (url === "https://resend.com/pricing") {
          pages.set(url, "Access denied.");
          continue;
        }
        pages.set(`${url}/`, `Pricing page. ${quotes.filter((q) => !(url === vercel.url && q === dropped.quote)).join(" ")} The Hobby plan now runs crons every hour. ${"Plans and limits. ".repeat(120)}`);
      }
      return { pages, failed };
    };
    const asked: string[] = [];
    const models = {
      available: true,
      modelId: () => "fake-super",
      complete: async (opts: { purpose: string; user: string }) => {
        asked.push(opts.purpose);
        return { changes: [{ was: dropped.quote, now: "The Hobby plan now runs crons every hour.", change: "Hobby crons went from once a day to every hour." }] };
      },
    } as unknown as ModelClient;
    const rows = await watchLimits({ extract, models, now: new Date("2026-10-27T12:00:00.000Z") });
    const urls = [...new Set(targets.map((t) => t.url))];
    expect(calls.flat().sort()).toEqual(urls.sort());
    expect(calls.every((c) => c.length <= 20)).toBe(true);
    const drift = rows.find((r) => r.vendor === "vercel" && r.url === vercel.url)!;
    expect(drift.missing).toEqual([dropped]);
    expect(drift.proposal).toContain("every hour");
    expect(drift.error).toBeNull();
    expect(asked).toEqual(["limits_watch"]);
    expect(rows.filter((r) => r.missing.length > 0)).toHaveLength(1);
    const failed = rows.find((r) => r.url === "https://documentation.onesignal.com/docs/en/billing-faq");
    expect(failed?.error).toBe("HTTP 403");
    const blocked = rows.find((r) => r.url === "https://resend.com/pricing");
    expect(blocked?.error).toContain("nearly empty");
    expect(blocked?.missing).toEqual([]);
    expect(rows.every((r) => r.checkedAt === "2026-10-27T12:00:00.000Z")).toBe(true);
  });
});
