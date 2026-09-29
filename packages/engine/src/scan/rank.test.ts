import { describe, expect, it } from "vitest";
import type { FindingDraft } from "@birdsi/shared";
import { rankFindings, summarise } from "./rank";

function draft(over: Partial<FindingDraft>): FindingDraft {
  return {
    key: over.key ?? Math.random().toString(36),
    checkId: "review",
    title: "A problem",
    explanation: "x",
    whyItMatters: "y",
    severity: "medium",
    confidence: "judgment",
    category: "gap",
    location: { path: "a.ts" },
    evidence: { advisories: [] },
    actionKind: "steps",
    steps: [],
    fixPlan: null,
    ...over,
  };
}

describe("rankFindings", () => {
  it("orders by severity then confidence", () => {
    const ranked = rankFindings([
      draft({ key: "1", severity: "low", confidence: "proven" }),
      draft({ key: "2", severity: "critical", confidence: "judgment" }),
      draft({ key: "3", severity: "critical", confidence: "proven" }),
      draft({ key: "4", severity: "high", confidence: "doc_verified" }),
    ]);
    expect(ranked.map((f) => f.key)).toEqual(["3", "2", "4", "1"]);
  });

  it("drops duplicate keys and model restatements of proven findings", () => {
    const ranked = rankFindings([
      draft({ key: "same", severity: "low" }),
      draft({ key: "same", severity: "high" }),
      draft({ key: "p", checkId: "secrets", confidence: "proven", severity: "critical", title: "A Stripe secret key is written into lib/pay.ts", location: { path: "lib/pay.ts" } }),
      draft({ key: "m", confidence: "judgment", severity: "high", title: "Stripe secret key written directly into lib/pay.ts", location: { path: "lib/pay.ts" } }),
      draft({ key: "other", confidence: "judgment", severity: "high", title: "Orders can be read by anyone", location: { path: "lib/pay.ts" } }),
    ]);
    expect(ranked.map((f) => f.key)).toEqual(["p", "same", "other"]);
    expect(ranked.find((f) => f.key === "same")?.severity).toBe("high");
  });
});

describe("summarise", () => {
  it("counts and picks the first critical and high findings to start with", () => {
    const findings = [
      draft({ key: "a", severity: "critical", actionKind: "fix" }),
      draft({ key: "b", severity: "high" }),
      draft({ key: "c", severity: "medium", confidence: "proven", actionKind: "fix" }),
    ];
    const summary = summarise(findings, ["id-a", "id-b", "id-c"]);
    expect(summary.bySeverity).toEqual({ critical: 1, high: 1, medium: 1, low: 0 });
    expect(summary.byConfidence.proven).toBe(1);
    expect(summary.fixable).toBe(2);
    expect(summary.needsYou).toBe(1);
    expect(summary.startWith).toEqual(["id-a", "id-b"]);
    expect(summary.headline).toContain("3 findings");
    expect(summary.headline).toContain("critical");
  });

  it("has a calm headline for a clean scan", () => {
    expect(summarise([], []).headline).toContain("Nothing found");
  });
});
