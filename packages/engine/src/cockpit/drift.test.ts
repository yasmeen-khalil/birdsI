import { describe, expect, it } from "vitest";
import type { Vendor } from "@birdsi/shared";
import { appAlerts } from "./alerts";

function vendor(slug: string, name: string): Vendor {
  return { id: `v-${slug}`, repoId: "r", slug, name, category: "hosting", what: "", purpose: null, detectedBy: ["package"], packages: [], envVars: [], callSites: [], pricingUrl: null, docsUrl: null, connectable: true, connected: false, facts: [], updatedAt: "2026-10-27T00:00:00.000Z" };
}

describe("a pricing page that changed", () => {
  it("opens a notice for the apps that use the vendor, with the model's proposal, checks the scope so a page that matches again closes it, and leaves a page that could not be read alone", () => {
    const drift = [
      { vendor: "vercel", url: "https://vercel.com/pricing", checkedAt: "2026-10-27T12:00:00.000Z", quotesTotal: 6, missing: [{ label: "Hobby: crons", quote: "1 cron job that runs once a day" }], proposal: "Hobby crons went from once a day to every hour. The page now says: Hobby runs crons every hour.", error: null },
      { vendor: "supabase", url: "https://supabase.com/pricing", checkedAt: "2026-10-27T12:00:00.000Z", quotesTotal: 4, missing: [], proposal: null, error: null },
      { vendor: "resend", url: "https://resend.com/pricing", checkedAt: "2026-10-27T12:00:00.000Z", quotesTotal: 3, missing: [{ label: "Free: domains", quote: "3 domains" }], proposal: null, error: null },
      { vendor: "onesignal", url: "https://onesignal.com/pricing", checkedAt: "2026-10-27T12:00:00.000Z", quotesTotal: 2, missing: [], proposal: null, error: "HTTP 403" },
    ];
    const vendors = [vendor("vercel", "Vercel"), vendor("supabase", "Supabase"), vendor("onesignal", "OneSignal")];
    const { drafts, checked } = appAlerts({ app: { name: "Cockpit", environments: ["production"] }, projects: [], map: null, reads: new Map(), vendors, deadlines: [], drift, now: new Date("2026-10-27T13:00:00.000Z") });
    const notices = drafts.filter((d) => d.kind === "limits_drift");
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ severity: "notice", scope: "limits_drift:vercel" });
    expect(notices[0]!.dedupeKey).toMatch(/^limits_drift:vercel:[0-9a-f]{8}$/);
    expect(notices[0]!.sentence).toContain("Vercel pricing page no longer has the sentence");
    expect(notices[0]!.sentence).toContain("Hobby: crons");
    expect(notices[0]!.action).toContain("every hour");
    expect(notices[0]!.action).toContain("closes when the page matches the list again");
    expect(checked).toEqual(expect.arrayContaining(["limits_drift:vercel", "limits_drift:supabase"]));
    expect(checked).not.toContain("limits_drift:resend");
    expect(checked).not.toContain("limits_drift:onesignal");
    // The same sentences gone a week later keep the key, so the notice refreshes instead of reopening.
    const later = appAlerts({ app: { name: "Cockpit", environments: ["production"] }, projects: [], map: null, reads: new Map(), vendors, deadlines: [], drift: drift.map((d) => ({ ...d, checkedAt: "2026-11-03T12:00:00.000Z" })), now: new Date("2026-11-03T13:00:00.000Z") });
    expect(later.drafts.find((d) => d.kind === "limits_drift")!.dedupeKey).toBe(notices[0]!.dedupeKey);
  });
});
