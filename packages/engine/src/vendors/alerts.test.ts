import { describe, expect, it } from "vitest";
import type { Vendor, VendorFact } from "@birdsi/shared";
import { computeAlerts, computeRunway, computeWatches, monthlySpend, stageStates } from "./alerts";

const fact = (over: Partial<VendorFact>): VendorFact => ({ id: "f", vendorId: "v", kind: "usage", metric: "m", label: "Requests", value: "", numeric: null, unit: null, limitNumeric: null, source: "connector", evidence: {}, observedAt: new Date().toISOString(), ...over });
const vendor = (over: Partial<Vendor>): Vendor => ({ id: "v", repoId: "r", slug: "acme", name: "Acme", category: "other", what: "", purpose: null, detectedBy: ["env"], packages: [], envVars: [], callSites: [], pricingUrl: null, docsUrl: null, connectable: false, connected: false, facts: [], updatedAt: new Date().toISOString(), ...over });

describe("computeAlerts", () => {
  it("warns at 80% and escalates at 95% of a limit", () => {
    const warn = computeAlerts([vendor({ facts: [fact({ numeric: 85, limitNumeric: 100, value: "85 of 100" })] })], new Map());
    expect(warn[0]?.level).toBe("warning");
    const crit = computeAlerts([vendor({ facts: [fact({ numeric: 96, limitNumeric: 100, value: "96 of 100" })] })], new Map());
    expect(crit[0]?.level).toBe("critical");
  });

  it("treats remaining-style metrics the other way round", () => {
    const alerts = computeAlerts([vendor({ facts: [fact({ metric: "credits_remaining", numeric: 3, limitNumeric: 100, value: "3 of 100" })] })], new Map());
    expect(alerts[0]?.level).toBe("critical");
  });

  it("never alerts about unconnected accounts, and suggests Stripe Projects upgrades", () => {
    expect(computeAlerts([vendor({ connectable: true })], new Map())).toEqual([]);
    const alerts = computeAlerts([vendor({ detectedBy: ["projects"], facts: [fact({ numeric: 90, limitNumeric: 100, value: "90 of 100" })] })], new Map());
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.suggestedCommand).toBe("stripe projects upgrade acme");
  });

  it("escalates a paused project to a critical alert", () => {
    const v = vendor({ slug: "supabase", name: "Supabase", facts: [fact({ kind: "status", metric: "paused_projects", numeric: 1, value: "app-db" })] });
    expect(computeAlerts([v], new Map())[0]?.level).toBe("critical");
  });
});

describe("monthlySpend", () => {
  it("adds only spend read from an account, never a plan's list price", () => {
    const total = monthlySpend([
      vendor({ facts: [fact({ kind: "plan", metric: "plan", value: "Pro" })] }),
      vendor({ id: "w", slug: "vercel", name: "Vercel", facts: [fact({ kind: "cost", metric: "spend_month", numeric: 12.5, value: "$12.50" })] }),
    ]);
    expect(total).toEqual({ totalUsd: 12.5, vendors: ["Vercel"] });
    expect(monthlySpend([vendor({ facts: [fact({ kind: "plan", metric: "plan", value: "Pro" })] })])).toBeNull();
  });
});

describe("stageStates", () => {
  it("marks the map and the reads never, fresh, stale and running", () => {
    const now = new Date().toISOString();
    const old = new Date(Date.now() - 10 * 86_400_000).toISOString();
    expect(stageStates({ lastMapAt: now, mapRunning: false, lastReadAt: old, readRunning: false }).map((s) => s.freshness)).toEqual(["fresh", "stale"]);
    expect(stageStates({ lastMapAt: null, mapRunning: false, lastReadAt: null, readRunning: true }).map((s) => s.freshness)).toEqual(["never", "running"]);
  });
});

describe("computeWatches", () => {
  it("tracks what the plan does from the checked list, without alerting", () => {
    const v = vendor({ slug: "supabase", name: "Supabase", facts: [fact({ kind: "plan", metric: "plan", value: "Free" })] });
    const watches = computeWatches([v]);
    expect(watches.map((w) => w.title)).toContain("Free plan: projects pause after a week without traffic");
    expect(computeAlerts([v], new Map())).toEqual([]);
  });

  it("tracks nothing when the plan is not known", () => {
    expect(computeWatches([vendor({ slug: "supabase", name: "Supabase" })])).toEqual([]);
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

describe("limits from the checked list", () => {
  it("compares usage with the checked limit of the plan the account is on", () => {
    const v = vendor({ slug: "supabase", name: "Supabase", facts: [fact({ kind: "plan", metric: "plan", value: "Free" }), fact({ metric: "db_size_mb", label: "Database size", numeric: 480, value: "480 MB" })] });
    const alerts = computeAlerts([v], new Map());
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.level).toBe("critical");
    expect(alerts[0]?.title).toBe("Supabase: database size at 96% of the limit");
  });

  it("says nothing when the plan is not known", () => {
    const v = vendor({ slug: "supabase", name: "Supabase", facts: [fact({ metric: "db_size_mb", label: "Database size", numeric: 480, value: "480 MB" })] });
    expect(computeAlerts([v], new Map())).toEqual([]);
  });
});
