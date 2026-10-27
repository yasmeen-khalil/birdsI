import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { cockpitView, listPricePerMonth, type AppProject, type Finding, type ProjectRead, type ServiceMap, type StoredMap, type Vendor, type VercelRead } from "@birdsi/shared";
import { collectDependencies } from "../inventory/manifests";
import { walkInventory } from "../inventory/walk";
import { buildServiceMap } from "../map/index";
import { discoverVendors } from "../vendors/discover";

let stored: StoredMap;

beforeAll(async () => {
  const fixture = resolve(import.meta.dirname, "../../fixtures/cockpit-app");
  const inventory = await walkInventory(fixture);
  const deps = await collectDependencies(inventory);
  const map: ServiceMap = await buildServiceMap(inventory, deps, await discoverVendors(inventory, deps, null), { commit: "abc1234def", branch: "main", readAt: "2026-10-18T12:00:00.000Z" });
  stored = { appId: "a", repoId: "r", scanId: "s", createdAt: "2026-10-18T12:00:00.000Z", map };
});

const email = { on: false, sentence: "Alerts are not emailed: RESEND_API_KEY is not set on birdsI." };

function project(id: string, vendor: string, kind: AppProject["kind"], ref: string, label: string | null, keyed: boolean): AppProject {
  return {
    id,
    appId: "a",
    vendor,
    kind,
    ref,
    label,
    environment: null,
    plan: null,
    settings: {},
    dashboardUrl: `https://example.com/${ref}`,
    key: keyed ? { id: `k-${id}`, label: null, scope: "read", fingerprint: "abc123", sharedWith: [], lastReadAt: null, lastStatus: null, lastError: null, createdAt: "2026-10-18T00:00:00.000Z" } : null,
    createdAt: "2026-10-18T00:00:00.000Z",
  };
}

describe("the cockpit view", () => {
  it("renders an app from its map alone: every part of the code, and the vendors to declare", () => {
    const view = cockpitView({ appName: "Lamp Post", environments: ["production"], projects: [], map: stored, mapReason: null, reads: new Map(), readsReason: null, alerts: [], alertsReason: null, email, vendors: [] });
    expect(view.map).toMatchObject({ commit: "abc1234def", roles: ["app", "ops"], roleEnv: "APP_ROLE" });
    expect(view.vercel).toEqual([]);
    expect(view.undeclared.map((u) => u.slug).sort()).toEqual(["onesignal", "supabase", "vercel"]);
    expect(view.services.map((s) => s.slug)).toEqual(expect.arrayContaining(["clerk", "stripe", "revenuecat", "resend"]));
    expect(view.crons.map((c) => [c.path, c.every, c.checksSecret])).toEqual([
      ["/api/cron/purge-deleted", "every day at 04:00 UTC", true],
      ["/api/cron/digest", "every 15 minutes", true],
    ]);
    expect(view.webhooks).toHaveLength(3);
    expect(view.storeApps[0]).toMatchObject({ bundleId: "com.example.cockpit", appName: "Cockpit" });
    expect(view.migrations).toMatchObject({ style: "numbered", files: 2, latest: "0002_social.sql", verify: { markers: 3 } });
  });

  it("puts each project's read beside what the code needs, and says why a card has no read", () => {
    const projects = [project("p-web", "vercel", "project", "cockpit", "product", true), project("p-ops", "vercel", "project", "cockpit-ops", "ops", false), project("p-db", "supabase", "project", "abcdefghijklmnopqrst", null, true)];
    const at = { readAt: "2026-10-18T20:00:00.000Z", source: { api: "x", page: null } };
    const data: VercelRead = {
      vendor: "vercel",
      project: { ok: true, ...at, value: { id: "prj_1", name: "cockpit", framework: "nextjs", productionUrl: "https://cockpit.example.com", paused: null, rootDirectory: "", createdAt: null } },
      deployments: { ok: true, ...at, value: [{ id: "d1", url: null, state: "READY", target: "production", createdAt: "2026-10-18T10:00:00.000Z", readyAt: null, commitSha: "abc1234", commitMessage: "Ship", branch: "main", errorMessage: null, inspectorUrl: null }] },
      env: { ok: true, ...at, value: ["CLERK_SECRET_KEY", "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"].map((key) => ({ key, targets: ["production"], type: "encrypted", gitBranch: null, updatedAt: null })) },
      crons: { ok: true, ...at, value: { enabled: true, definitions: [{ path: "/api/cron/purge-deleted", schedule: "0 4 * * *" }], updatedAt: null, deploymentId: null } },
      domains: { ok: false, ...at, reason: "Vercel refused the key for this (HTTP 403)." },
      errors: { ok: true, ...at, value: [] },
      keyExpiry: { ok: true, ...at, value: { expiresAt: null } },
    };
    const reads = new Map<string, ProjectRead>([["p-web", { id: "r1", appId: "a", projectId: "p-web", vendor: "vercel", readAt: at.readAt, problems: 1, data }]]);
    const view = cockpitView({ appName: "Cockpit", environments: ["production"], projects, map: stored, mapReason: null, reads, readsReason: null, alerts: [], alertsReason: null, email, vendors: [] });

    const web = view.vercel.find((c) => c.projectId === "p-web")!;
    expect(web).toMatchObject({ title: "cockpit (product)", role: "app", state: "read", productionUrl: "https://cockpit.example.com" });
    expect(web.env.ok && web.env.value[0]!.missing).toEqual(expect.arrayContaining(["CRON_SECRET", "SUPABASE_SECRET_KEY"]));
    expect(web.crons.ok && web.crons.value.expected).toEqual([
      { path: "/api/cron/purge-deleted", every: "every day at 04:00 UTC", registered: true },
      { path: "/api/cron/digest", every: "every 15 minutes", registered: false },
    ]);
    expect(web.domains).toEqual({ ok: false, reason: "Vercel refused the key for this (HTTP 403)." });
    const ops = view.vercel.find((c) => c.projectId === "p-ops")!;
    expect(ops).toMatchObject({ role: "ops", state: "no_key", reason: expect.stringContaining("No key yet") });
    expect(view.supabase[0]).toMatchObject({ state: "not_read", reason: expect.stringContaining("Not read yet") });
    expect(view.undeclared.map((u) => u.slug)).toEqual(["onesignal"]);
    expect(view.crons[0]!.projects).toEqual([
      { title: "cockpit (product)", registered: true },
      { title: "cockpit-ops (ops)", registered: null },
    ]);
  });

  it("says once, on every card, when the reads wait on a migration", () => {
    const projects = [project("p-web", "vercel", "project", "cockpit", "product", true)];
    const view = cockpitView({ appName: "Cockpit", environments: ["production"], projects, map: null, mapReason: "No service map of this app yet.", reads: new Map(), readsReason: "Project reads are kept once the migration 20261018000300_project_reads.sql has run in the Supabase SQL editor.", alerts: [], alertsReason: null, email, vendors: [] });
    expect(view.vercel[0]).toMatchObject({ state: "no_reads", reason: expect.stringContaining("20261018000300") });
    expect(view.map).toBeNull();
    expect(view.vercel[0]!.env).toEqual({ ok: false, reason: "No service map of this app yet." });
  });
});

function vendor(slug: string, name: string, category: Vendor["category"], facts: Array<Partial<Vendor["facts"][number]> & Pick<Vendor["facts"][number], "kind" | "metric" | "label" | "value">>): Vendor {
  return {
    id: `v-${slug}`,
    repoId: "r",
    slug,
    name,
    category,
    what: "",
    purpose: null,
    detectedBy: ["package"],
    packages: [],
    envVars: [],
    callSites: [],
    pricingUrl: null,
    docsUrl: `https://${slug}.example/docs`,
    connectable: true,
    connected: true,
    facts: facts.map((f, i) => ({ id: `f-${slug}-${i}`, vendorId: `v-${slug}`, numeric: null, unit: null, limitNumeric: null, source: "connector", evidence: {}, observedAt: "2026-10-27T00:00:00.000Z", ...f })),
    updatedAt: "2026-10-27T00:00:00.000Z",
  };
}

function finding(id: string, over: Partial<Finding>): Finding {
  return {
    id,
    scanId: "s",
    repoId: "r",
    key: `k-${id}`,
    checkId: "gaps",
    title: `Finding ${id}`,
    explanation: "",
    whyItMatters: "",
    severity: "low",
    confidence: "proven",
    category: "gap",
    location: null,
    evidence: { advisories: [] },
    actionKind: "fix",
    steps: [],
    fixPlan: null,
    status: "open",
    createdAt: "2026-10-27T00:00:00.000Z",
    ...over,
  };
}

describe("the cockpit's sections", () => {
  it("groups services by what they are for, with their docs, and summarizes dependencies, security and money", () => {
    const vendors = [
      vendor("vercel", "Vercel", "hosting", [
        { kind: "plan", metric: "plan", label: "Plan", value: "pro" },
        { kind: "cost", metric: "spend_month", label: "Spend this month", value: "$12.50", numeric: 12.5, unit: "USD" },
        { kind: "usage", metric: "function_invocations", label: "Function invocations", value: "500,000", numeric: 500_000, limitNumeric: 1_000_000 },
      ]),
      vendor("stripe", "Stripe", "payments", []),
    ];
    const findings = [
      finding("1", { severity: "high", category: "security", title: "The webhook does not check who sent the request", location: { path: "src/app/api/stripe/webhook/route.ts" } }),
      finding("2", { severity: "low", category: "stale" }),
      finding("3", { severity: "critical", category: "security", status: "dismissed" }),
    ];
    const dependencies = [
      { ecosystem: "npm" as const, name: "stripe", versionInUse: "14.0.0", latestVersion: "17.0.0", manifestPath: "package.json", direct: true, vulnerabilities: [], docsCheck: { status: "current" as const, checkedAt: "2026-10-27T09:00:00.000Z", doc: { url: "https://docs.stripe.com/api", title: "Stripe API", excerpt: "" } } },
      { ecosystem: "npm" as const, name: "eslint", versionInUse: "9.0.0", latestVersion: "9.1.0", manifestPath: "package.json", direct: true, vulnerabilities: [], docsCheck: null },
    ];
    const view = cockpitView({ appName: "Cockpit", environments: ["production"], projects: [], map: stored, mapReason: null, reads: new Map(), readsReason: null, alerts: [], alertsReason: null, email, vendors, dependencies, findings, scope: null, scanFinishedAt: "2026-10-27T10:00:00.000Z" });

    expect(view.purposeGroups.map((g) => g.label)[0]).toBe("Hosting");
    expect(view.purposeGroups.flatMap((g) => g.services.map((s) => s.slug))).toEqual(expect.arrayContaining(["vercel", "stripe", "clerk"]));
    const stripe = view.services.find((s) => s.slug === "stripe")!;
    expect(stripe.docs).toMatchObject({ url: "https://docs.stripe.com/api", checkedAt: "2026-10-27T09:00:00.000Z", status: "current", packages: 1 });
    expect(stripe.icon).toBe("https://cdn.simpleicons.org/stripe");
    expect(view.dependencies).toMatchObject({ total: 2, direct: 2, behind: 1, docsChecked: 1, docsCheckedAt: "2026-10-27T09:00:00.000Z", devtools: ["eslint"] });

    expect(view.security).toMatchObject({ total: 2, bySeverity: { critical: 0, high: 1, medium: 0, low: 1 }, finishedAt: "2026-10-27T10:00:00.000Z" });
    expect(view.security!.byCategory).toEqual([
      { category: "security", label: "Security", count: 1, worst: "high" },
      { category: "stale", label: "Stale code and settings", count: 1, worst: "low" },
    ]);
    expect(view.security!.top[0]).toMatchObject({ id: "1", severity: "high", path: "src/app/api/stripe/webhook/route.ts" });

    const read = view.money.lines.find((l) => l.kind === "read")!;
    expect(read).toMatchObject({ slug: "vercel", monthlyUsd: 12.5, yearlyUsd: 150 });
    expect(view.money.monthlyReadUsd).toBe(12.5);
    expect(view.money.yearlyReadUsd).toBe(150);
    expect(view.money.lines.some((l) => l.kind === "list" && l.slug === "vercel")).toBe(true);
    expect(view.money.limits[0]).toMatchObject({ slug: "vercel", used: 500_000, limit: 1_000_000, pct: 50 });
  });

  it("reads a list price from the words on the checked list", () => {
    expect(listPricePerMonth("$20 a month")).toBe(20);
    expect(listPricePerMonth("$0 a month")).toBe(0);
    expect(listPricePerMonth("$99 a year")).toBe(8.25);
    expect(listPricePerMonth("Contact sales")).toBeNull();
  });
});
