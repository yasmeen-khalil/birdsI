import { describe, expect, it } from "vitest";
import type { MapWebhook, ProjectReadData, ServiceMap, Vendor, VendorFact, VercelRead } from "@birdsi/shared";
import { appAlerts } from "./alerts";

const NOW = new Date("2026-10-27T13:00:00.000Z");
const at = { readAt: NOW.toISOString(), source: { api: "x", page: null } };

function webhook(route: string, service = "stripe"): MapWebhook {
  return { route, file: `src/app${route}/route.ts`, service, verifies: null, methods: ["POST"], found: null };
}

function mapWith(webhooks: MapWebhook[]): ServiceMap {
  return { webhooks, crons: [], env: [], services: [] } as unknown as ServiceMap;
}

function fact(metric: string, label: string, value: string, numeric: number | null): VendorFact {
  return { id: `f-${metric}`, vendorId: "v-stripe", kind: "status", metric, label, value, numeric, unit: null, limitNumeric: null, source: "connector", evidence: {}, observedAt: NOW.toISOString() };
}

function stripe(facts: VendorFact[]): Vendor {
  return { id: "v-stripe", repoId: "r", slug: "stripe", name: "Stripe", category: "payments", what: "", purpose: null, detectedBy: ["package"], packages: ["stripe"], envVars: [], callSites: [], pricingUrl: null, docsUrl: null, connectable: true, connected: true, facts, updatedAt: NOW.toISOString() };
}

function endpoints(list: Array<{ id: string; url: string; enabled: boolean }>): VendorFact[] {
  return [fact("webhook_endpoints", "Webhook endpoints", `${list.length} registered`, list.length), ...list.map((e) => fact(`webhook_endpoint:${e.id}`, `Webhook endpoint, ${e.enabled ? "enabled" : "disabled"}`, e.url, e.enabled ? 1 : 0))];
}

function vercel(productionUrl: string | null): VercelRead {
  return {
    vendor: "vercel",
    project: { ok: true, ...at, value: { id: "prj_1", name: "shop", framework: "nextjs", productionUrl, paused: null, rootDirectory: "", createdAt: null } },
    deployments: { ok: true, ...at, value: [] },
    env: { ok: true, ...at, value: [] },
    crons: { ok: true, ...at, value: { enabled: true, definitions: [], updatedAt: null, deploymentId: null } },
    domains: { ok: true, ...at, value: [] },
    errors: { ok: true, ...at, value: [] },
    keyExpiry: { ok: true, ...at, value: { expiresAt: null } },
  };
}

function run(webhooks: MapWebhook[], facts: VendorFact[], reads: Map<string, ProjectReadData> = new Map([["p1", vercel("https://shop.example.com")]])) {
  return appAlerts({ app: { name: "Shop", environments: ["production"] }, projects: [], map: mapWith(webhooks), reads, vendors: [stripe(facts)], deadlines: [], now: NOW });
}

describe("the code's Stripe webhooks against the endpoints registered at Stripe", () => {
  it("is quiet when an enabled endpoint points at the route on the app's host, and checks both scopes", () => {
    const { drafts, checked } = run([webhook("/api/webhooks/stripe")], endpoints([{ id: "we_1", url: "https://shop.example.com/api/webhooks/stripe/", enabled: true }]));
    expect(drafts.filter((d) => d.kind.startsWith("webhook_"))).toHaveLength(0);
    expect(checked).toEqual(expect.arrayContaining(["webhook_unregistered:stripe", "webhook_unhandled:stripe"]));
  });

  it("warns when no enabled endpoint points at a route the code has, and says when the one that does is disabled", () => {
    const none = run([webhook("/api/webhooks/stripe")], endpoints([{ id: "we_9", url: "https://other.example.com/api/webhooks/stripe", enabled: true }]));
    const missing = none.drafts.find((d) => d.kind === "webhook_unregistered")!;
    expect(missing.sentence).toBe("The code handles Stripe webhooks at /api/webhooks/stripe (src/app/api/webhooks/stripe/route.ts), but none of the endpoint registered at Stripe for shop.example.com points there, so Stripe sends it nothing.");
    expect(missing.action).toContain("https://shop.example.com/api/webhooks/stripe");
    expect(missing.dedupeKey).toBe("webhook_unregistered:stripe:/api/webhooks/stripe");
    const off = run([webhook("/api/webhooks/stripe")], endpoints([{ id: "we_1", url: "https://shop.example.com/api/webhooks/stripe", enabled: false }]));
    expect(off.drafts.find((d) => d.kind === "webhook_unregistered")!.sentence).toContain("is disabled, so Stripe sends it nothing");
  });

  it("warns when an enabled endpoint points at the app with no route behind it, and not for another host", () => {
    const { drafts } = run([webhook("/api/webhooks/stripe"), webhook("/api/webhooks/clerk", "clerk")], endpoints([
      { id: "we_1", url: "https://shop.example.com/api/webhooks/stripe", enabled: true },
      { id: "we_2", url: "https://shop.example.com/api/hooks/old", enabled: true },
      { id: "we_3", url: "https://shop.example.com/api/webhooks/clerk", enabled: true },
      { id: "we_4", url: "https://elsewhere.example.com/api/hooks/old", enabled: true },
    ]));
    const unhandled = drafts.filter((d) => d.kind === "webhook_unhandled");
    expect(unhandled).toHaveLength(1);
    expect(unhandled[0]!.sentence).toContain("https://shop.example.com/api/hooks/old");
    expect(unhandled[0]!.sentence).toContain("no webhook route at /api/hooks/old");
  });

  it("compares paths alone when no host is known, and never flags an endpoint it cannot place", () => {
    const { drafts, checked } = run([webhook("/api/webhooks/stripe")], endpoints([{ id: "we_1", url: "https://somewhere.example.com/api/webhooks/stripe", enabled: true }, { id: "we_2", url: "https://somewhere.example.com/api/hooks/old", enabled: true }]), new Map());
    expect(drafts.filter((d) => d.kind.startsWith("webhook_"))).toHaveLength(0);
    expect(checked).toContain("webhook_unregistered:stripe");
  });

  it("changes nothing when the endpoints were not read this time", () => {
    const { drafts, checked } = run([webhook("/api/webhooks/stripe")], [fact("webhooks_access", "Webhook endpoints", "Not read: give the restricted key Webhook Endpoints: Read.", null)]);
    expect(drafts.filter((d) => d.kind.startsWith("webhook_"))).toHaveLength(0);
    expect(checked.some((c) => c.startsWith("webhook_"))).toBe(false);
  });
});
