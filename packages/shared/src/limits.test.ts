import { describe, expect, it } from "vitest";
import { LIMITS_BY_SLUG, tierFor, VENDOR_LIMITS } from "./limits";

describe("the checked limits list", () => {
  it("dates every vendor and cites every number and condition", () => {
    for (const v of VENDOR_LIMITS) {
      expect(v.verifiedOn, v.slug).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(v.pricingUrl, v.slug).toMatch(/^https:\/\//);
      expect(v.tiers.length, v.slug).toBeGreaterThan(0);
      for (const t of v.tiers) {
        expect(t.endsWhen.trim(), `${v.slug} ${t.name}`).not.toBe("");
        for (const l of t.limits) {
          expect(l.metric, `${v.slug} ${t.name}`).toMatch(/^[a-z0-9_]+$/);
          expect(l.amount, `${v.slug} ${t.name} ${l.metric}`).toBeGreaterThan(0);
          expect(l.source.url, `${v.slug} ${l.metric}`).toMatch(/^https:\/\//);
          expect(l.source.quote.trim(), `${v.slug} ${l.metric}`).not.toBe("");
        }
        for (const c of t.conditions) {
          expect(c.source.url, `${v.slug} ${c.id}`).toMatch(/^https:\/\//);
          expect(c.source.quote.trim(), `${v.slug} ${c.id}`).not.toBe("");
        }
      }
    }
  });

  it("has one entry per vendor", () => {
    expect(LIMITS_BY_SLUG.size).toBe(VENDOR_LIMITS.length);
  });

  it("matches plan names exactly, so Pro never matches a longer name", () => {
    const vercel = LIMITS_BY_SLUG.get("vercel")!;
    expect(tierFor(vercel, "pro")?.name).toBe("Pro");
    expect(tierFor(vercel, "Hobby plan")?.name).toBe("Hobby");
    expect(tierFor(vercel, "Pro Plus")).toBeNull();
    expect(tierFor(vercel, "")).toBeNull();
  });

  it("records the OneSignal change of 1 October 2026", () => {
    const free = tierFor(LIMITS_BY_SLUG.get("onesignal")!, "free")!;
    expect(free.limits.find((l) => l.metric === "mobile_mau")?.amount).toBe(1000);
  });
});
