import { describe, expect, it } from "vitest";
import type { Vendor, VendorFact } from "@birdsi/shared";
import { computeAlerts, monthlySpend, stageStates } from "./alerts";

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

  it("asks for the plan only when tiers are known, and suggests Stripe Projects upgrades", () => {
    const knowledge = new Map([["acme", { slug: "acme", name: "Acme", what: "", pricingUrl: null, tiers: [{ name: "Free", priceUsd: 0, priceNote: null, limits: [] }], sources: [], fetchedAt: new Date().toISOString() }]]);
    const alerts = computeAlerts([vendor({ detectedBy: ["projects"], facts: [fact({ numeric: 90, limitNumeric: 100, value: "90 of 100" })] })], knowledge, new Map());
    expect(alerts.find((a) => a.id.endsWith(":plan"))).toBeTruthy();
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
