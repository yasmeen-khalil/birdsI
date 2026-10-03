import { describe, expect, it } from "vitest";
import type { Vendor, VendorFact } from "@birdsi/shared";
import { computeAlerts, computeRunway, computeWatches, monthlySpend, stageStates } from "./alerts";

const fact = (over: Partial<VendorFact>): VendorFact => ({ id: "f", vendorId: "v", kind: "usage", metric: "m", label: "Requests", value: "", numeric: null, unit: null, limitNumeric: null, source: "connector", evidence: {}, observedAt: new Date().toISOString(), ...over });
const vendor = (over: Partial<Vendor>): Vendor => ({ id: "v", repoId: "r", slug: "acme", name: "Acme", category: "other", what: "", purpose: null, detectedBy: ["env"], packages: [], envVars: [], callSites: [], pricingUrl: null, docsUrl: null, connectable: false, connected: false, facts: [], updatedAt: new Date().toISOString(), ...over });

describe("computeAlerts", () => {
  it("warns at 80% and escalates at 95% of a limit", () => {
    const warn = computeAlerts([vendor({ facts: [fact({ numeric: 85, limitNumeric: 100, value: "85 of 100" })] })], new Map(), new Map());
    expect(warn[0]?.level).toBe("warning");
    const crit = computeAlerts([vendor({ facts: [fact({ numeric: 96, limitNumeric: 100, value: "96 of 100" })] })], new Map(), new Map());
    expect(crit[0]?.level).toBe("critical");
  });

  it("treats remaining-style metrics the other way round", () => {
    const alerts = computeAlerts([vendor({ facts: [fact({ metric: "credits_remaining", numeric: 3, limitNumeric: 100, value: "3 of 100" })] })], new Map(), new Map());
    expect(alerts[0]?.level).toBe("critical");
  });

  it("never alerts about unknown plans or unconnected accounts, and suggests Stripe Projects upgrades", () => {
    const knowledge = new Map([["acme", { slug: "acme", name: "Acme", what: "", pricingUrl: null, tiers: [{ name: "Free", priceUsd: 0, priceNote: null, limits: [] }], sources: [], fetchedAt: new Date().toISOString() }]]);
    const quiet = computeAlerts([vendor({ connectable: true })], knowledge, new Map());
    expect(quiet).toEqual([]);
    const alerts = computeAlerts([vendor({ detectedBy: ["projects"], facts: [fact({ numeric: 90, limitNumeric: 100, value: "90 of 100" })] })], knowledge, new Map());
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.suggestedCommand).toBe("stripe projects upgrade acme");
  });
});

describe("monthlySpend", () => {
  it("sums spend facts and plan prices", () => {
    const knowledge = new Map([["acme", { slug: "acme", name: "Acme", what: "", pricingUrl: null, tiers: [{ name: "Pro", priceUsd: 25, priceNote: null, limits: [] }], sources: [], fetchedAt: new Date().toISOString() }]]);
    const total = monthlySpend([vendor({ facts: [fact({ kind: "plan", metric: "plan", value: "Pro" })] }), vendor({ id: "w", slug: "vercel", facts: [fact({ kind: "cost", metric: "spend_month", numeric: 12.5, value: "$12.50" })] })], knowledge);
    expect(total).toBe(37.5);
  });
});

describe("stageStates", () => {
  it("marks stages never, fresh, stale and running", () => {
    const now = new Date().toISOString();
    const old = new Date(Date.now() - 10 * 86_400_000).toISOString();
    const stages = stageStates({ lastScanAt: now, lastScanRunning: false, lastDocsAt: old, lastAuditAt: null, lastOpsAt: null, opsRunning: true });
    expect(stages.map((s) => s.freshness)).toEqual(["fresh", "stale", "never", "running"]);
  });
});

describe("computeWatches", () => {
  it("tracks plan conditions without alerting", () => {
    const knowledge = new Map([["supabase", { slug: "supabase", name: "Supabase", what: "", pricingUrl: null, tiers: [{ name: "Free", priceUsd: 0, priceNote: null, limits: [{ metric: "pause", label: "Projects pause after 7 days of inactivity", amount: null, unit: null, note: "Free projects pause after a week without traffic." }] }], sources: [], fetchedAt: new Date().toISOString() }]]);
    const v = vendor({ slug: "supabase", name: "Supabase", facts: [fact({ kind: "plan", metric: "plan", value: "Free" })] });
    const watches = computeWatches([v], knowledge);
    expect(watches.length).toBeGreaterThan(0);
    expect(computeAlerts([v], knowledge, new Map()).some((a) => a.level !== "info")).toBe(false);
  });

  it("escalates a paused project to a critical alert", () => {
    const v = vendor({ slug: "supabase", name: "Supabase", facts: [fact({ kind: "status", metric: "paused_projects", numeric: 1, value: "app-db" })] });
    expect(computeAlerts([v], new Map(), new Map())[0]?.level).toBe("critical");
  });
});

describe("computeRunway", () => {
  it("projects when a counted limit runs out", () => {
    const day = 86_400_000;
    const now = Date.now();
    const runway = computeRunway(
      [
        { metric: "credits_month", numeric: 10, limit_numeric: 100, observed_at: new Date(now - 2 * day).toISOString() },
        { metric: "credits_month", numeric: 30, limit_numeric: 100, observed_at: new Date(now).toISOString() },
      ],
      new Map([["credits_month", "Credits"]]),
    );
    expect(runway[0]?.perDay).toBe(10);
    expect(runway[0]?.daysLeft).toBe(7);
    expect(runway[0]?.runsOutAt).toBeTruthy();
  });

  it("needs two readings at least an hour apart", () => {
    expect(computeRunway([{ metric: "m", numeric: 1, limit_numeric: 10, observed_at: new Date().toISOString() }], new Map())).toEqual([]);
  });
});
