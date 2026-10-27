import { describe, expect, it } from "vitest";
import type { Vendor, VendorFact } from "@birdsi/shared";
import { appAlerts } from "./alerts";

const NOW = new Date("2026-10-27T13:00:00.000Z");

function fact(metric: string, label: string, value: string, numeric: number | null, source: VendorFact["source"] = "connector"): VendorFact {
  return { id: `f-${metric}`, vendorId: "v", kind: "status", metric, label, value, numeric, unit: null, limitNumeric: null, source, evidence: { url: `https://example.com/${metric}` }, observedAt: NOW.toISOString() };
}

function vendor(slug: string, name: string, facts: VendorFact[]): Vendor {
  return { id: `v-${slug}`, repoId: "r", slug, name, category: "other", what: "", purpose: null, detectedBy: ["declared"], packages: [], envVars: [], callSites: [], pricingUrl: null, docsUrl: null, connectable: true, connected: true, facts, updatedAt: NOW.toISOString() };
}

function run(vendors: Vendor[]) {
  return appAlerts({ app: { name: "Lamp Post", environments: ["production"] }, projects: [], map: null, reads: new Map(), vendors, deadlines: [], now: NOW });
}

describe("alerts from what a connector read", () => {
  it("turns a failed run, open secrets and serious dependency alerts into alerts, one per cause, and checks their scopes", () => {
    const { drafts, checked } = run([
      vendor("github", "GitHub", [
        fact("repository", "Repository", "Private, default branch main", null),
        fact("ci_failed", "Actions, failed run", "The newest run of Deploy on main of acme/app failed on 27 October 2026", 1),
        fact("secrets_open", "Secret scanning alerts open", "2 open: Stripe API Key, GitHub Personal Access Token", 2),
        fact("dependabot_serious", "Dependabot alerts, critical or high", "1 open: lodash", 1),
        fact("code_scanning_open", "Code scanning alerts open", "None", 0),
      ]),
    ]);
    const kinds = drafts.map((d) => d.kind).sort();
    expect(kinds).toEqual(["ci_failed", "dependency_alert", "secret_alert"]);
    const ci = drafts.find((d) => d.kind === "ci_failed")!;
    expect(ci.sentence).toBe("The newest run of Deploy on main of acme/app failed on 27 October 2026, so the default branch no longer passes its own checks.");
    expect(ci.source.url).toBe("https://example.com/ci_failed");
    expect(ci.dedupeKey).toBe("ci_failed:v-github:ci_failed");
    const secret = drafts.find((d) => d.kind === "secret_alert")!;
    expect(secret.severity).toBe("critical");
    expect(secret.sentence).toContain("2 secrets");
    expect(checked).toEqual(expect.arrayContaining(["ci_failed:v-github", "secret_alert:v-github", "dependency_alert:v-github", "code_alert:v-github"]));
  });

  it("alerts on a rejected App Store version and a build that did not process", () => {
    const { drafts } = run([
      vendor("apple", "App Store Connect", [
        fact("version_rejected", "Rejected by App Review", "1.5.0 on iOS, metadata rejected", 1),
        fact("build_failed", "Build did not process", "Build 58, uploaded 20 October 2026 (failed to process)", 1),
      ]),
    ]);
    expect(drafts.map((d) => d.kind).sort()).toEqual(["build_failed", "store_rejected"]);
    expect(drafts.find((d) => d.kind === "store_rejected")!.sentence).toBe("App Review rejected a version of the app: 1.5.0 on iOS, metadata rejected.");
  });

  it("leaves what is open alone when nothing was read from the vendor, and ignores facts that did not come from the account", () => {
    const nothing = run([vendor("github", "GitHub", [])]);
    expect(nothing.checked.some((c) => c.endsWith(":v-github"))).toBe(false);
    const docsOnly = run([vendor("github", "GitHub", [fact("ci_failed", "Actions", "x", 1, "docs")])]);
    expect(docsOnly.drafts.filter((d) => d.kind === "ci_failed")).toHaveLength(0);
    expect(docsOnly.checked.some((c) => c.endsWith(":v-github"))).toBe(false);
  });

  it("makes one alert per project when a vendor has several", () => {
    const { drafts } = run([vendor("github", "GitHub", [fact("ci_failed:product", "Actions, failed run (product)", "The newest run of Deploy on main of acme/product failed on 27 October 2026", 1), fact("ci_failed:ops", "Actions, failed run (ops)", "The newest run of Deploy on main of acme/ops failed on 27 October 2026", 1)])]);
    expect(drafts.filter((d) => d.kind === "ci_failed").map((d) => d.dedupeKey).sort()).toEqual(["ci_failed:v-github:ci_failed:ops", "ci_failed:v-github:ci_failed:product"]);
  });
});
