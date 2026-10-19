import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { AppDeadline, OneSignalRead, ProjectReadData, ServiceMap, SupabaseRead, Vendor, VercelRead } from "@birdsi/shared";
import { collectDependencies } from "../inventory/manifests";
import { walkInventory } from "../inventory/walk";
import { buildServiceMap } from "../map/index";
import { discoverVendors } from "../vendors/discover";
import { appAlerts, type AlertProject } from "./alerts";

const NOW = new Date("2026-10-18T21:00:00Z");
const at = (iso: string) => ({ readAt: "2026-10-18T20:59:00.000Z", source: { api: "https://api.example", page: iso } });
let map: ServiceMap;

beforeAll(async () => {
  const fixture = resolve(import.meta.dirname, "../../fixtures/cockpit-app");
  const inventory = await walkInventory(fixture);
  const deps = await collectDependencies(inventory);
  map = await buildServiceMap(inventory, deps, await discoverVendors(inventory, deps, null), { commit: "abc1234", branch: "main" });
});

const projects: AlertProject[] = [
  { id: "p-web", vendor: "vercel", kind: "project", ref: "cockpit", label: "product", plan: null, dashboardUrl: "https://vercel.com/acme/cockpit" },
  { id: "p-ops", vendor: "vercel", kind: "project", ref: "cockpit-ops", label: "ops", plan: null, dashboardUrl: "https://vercel.com/acme/cockpit-ops" },
  { id: "p-db", vendor: "supabase", kind: "project", ref: "abcdefghijklmnopqrst", label: null, plan: null, dashboardUrl: "https://supabase.com/dashboard/project/abcdefghijklmnopqrst" },
  { id: "p-push", vendor: "onesignal", kind: "app", ref: "5eb5a37e-b458-11e3-ac11-000c2940e62c", label: null, plan: "Free", dashboardUrl: "https://dashboard.onesignal.com/apps/x" },
];

function vercel(name: string, env: string[], extra: Partial<VercelRead> = {}): VercelRead {
  return {
    vendor: "vercel",
    project: { ok: true, ...at(`https://vercel.com/acme/${name}`), value: { id: `prj_${name}`, name, framework: "nextjs", productionUrl: `https://${name}.example.com`, paused: null, rootDirectory: "", createdAt: null } },
    deployments: { ok: true, ...at("deployments"), value: [{ id: `dpl_${name}_ok`, url: null, state: "READY", target: "production", createdAt: "2026-10-17T10:00:00.000Z", readyAt: null, commitSha: "aaa1111", commitMessage: "v1", branch: "main", errorMessage: null, inspectorUrl: null }] },
    env: { ok: true, ...at("env"), value: env.map((key) => ({ key, targets: ["production", "preview"], type: "encrypted", gitBranch: null, updatedAt: null })) },
    crons: { ok: true, ...at("crons"), value: { enabled: true, definitions: [{ path: "/api/cron/purge-deleted", schedule: "0 4 * * *" }, { path: "/api/cron/digest", schedule: "*/15 * * * *" }], updatedAt: null, deploymentId: null } },
    domains: { ok: true, ...at("domains"), value: [] },
    errors: { ok: true, ...at("logs"), value: [] },
    keyExpiry: { ok: true, ...at("tokens"), value: { expiresAt: null } },
    ...extra,
  };
}

const productEnv = ["CLERK_SECRET_KEY", "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "CLERK_WEBHOOK_SECRET", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY", "CRON_SECRET", "STRIPE_SECRET_KEY", "RESEND_API_KEY", "ONESIGNAL_API_KEY", "NEXT_PUBLIC_ONESIGNAL_APP_ID", "REVENUECAT_WEBHOOK_SECRET", "STRIPE_WEBHOOK_SECRET", "DEV_ALERT_EMAIL"];

function vendor(slug: string, name: string, facts: Array<{ kind: "plan" | "usage"; metric: string; label: string; value: string; numeric: number | null; unit: string | null }>): Vendor {
  return {
    id: `v-${slug}`,
    repoId: "r",
    slug,
    name,
    category: "hosting",
    what: "",
    purpose: null,
    detectedBy: ["package"],
    packages: [],
    envVars: [],
    callSites: [],
    dashboardUrl: null,
    pricingUrl: null,
    docsUrl: null,
    connectable: true,
    connected: true,
    updatedAt: NOW.toISOString(),
    facts: facts.map((f, i) => ({ id: `f${i}`, kind: f.kind, metric: f.metric, label: f.label, value: f.value, numeric: f.numeric, unit: f.unit, limitNumeric: null, source: "connector", evidence: {}, observedAt: NOW.toISOString(), expiresAt: null })),
  } as unknown as Vendor;
}

describe("the alert rules", () => {
  it("finds each cause with its object, actor, rule and result, and the scopes it checked", () => {
    const supabase: SupabaseRead = {
      vendor: "supabase",
      project: { ok: true, ...at("https://supabase.com/dashboard/project/abcdefghijklmnopqrst"), value: { ref: "abcdefghijklmnopqrst", name: "cockpit-db", region: null, status: "ACTIVE_HEALTHY", paused: false, createdAt: null, postgresVersion: null } },
      size: { ok: true, ...at("size"), value: { bytes: 471_859_200 } },
      security: { ok: true, ...at("security"), value: [] },
      performance: { ok: true, ...at("performance"), value: [] },
      migrations: { ok: true, ...at("sql"), value: { method: "markers", how: "", checked: 3, owed: [{ migration: "0002_social.sql", file: "supabase/migrations/0002_social.sql", missing: ["the table follows"] }], unknown: [] } },
    };
    const onesignal: OneSignalRead = {
      vendor: "onesignal",
      app: { ok: true, ...at("https://dashboard.onesignal.com/apps/x"), value: { id: "x", name: "Cockpit", subscriptions: 1500, subscribed: 1300, platforms: ["ios"], updatedAt: null } },
      audience: { ok: true, ...at("segments"), value: { pushRecipients: 1290, mobileSuppressed: true } },
      notifications: { ok: true, ...at("n"), value: { total: 0, recent: [] } },
    };
    const reads = new Map<string, ProjectReadData>([
      ["p-web", vercel("cockpit", productEnv.filter((n) => n !== "CRON_SECRET"), {
        deployments: { ok: true, ...at("deployments"), value: [
          { id: "dpl_new", url: null, state: "ERROR", target: "production", createdAt: "2026-10-18T19:00:00.000Z", readyAt: null, commitSha: "bbb2222abc", commitMessage: "Add the digest", branch: "main", errorMessage: "Command \"npm run build\" exited with 1", inspectorUrl: "https://vercel.com/acme/cockpit/dpl_new" },
          { id: "dpl_old", url: null, state: "READY", target: "production", createdAt: "2026-10-17T10:00:00.000Z", readyAt: null, commitSha: "aaa1111", commitMessage: "v1", branch: "main", errorMessage: null, inspectorUrl: null },
        ] },
        crons: { ok: true, ...at("crons"), value: { enabled: true, definitions: [{ path: "/api/cron/purge-deleted", schedule: "0 4 * * *" }], updatedAt: null, deploymentId: null } },
        keyExpiry: { ok: true, ...at("tokens"), value: { expiresAt: "2026-10-23T00:00:00.000Z" } },
      })],
      ["p-ops", vercel("cockpit-ops", ["APP_ROLE", "CLERK_SECRET_KEY", "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY"])],
      ["p-db", supabase],
      ["p-push", onesignal],
    ]);
    const deadlines: AppDeadline[] = [{ id: "d1", appId: "a", vendor: "onesignal", label: "The OneSignal trial ends", dueOn: "2026-10-28", note: "After it the plan is Free.", createdAt: "2026-10-01T09:00:00.000Z" }];
    const vendors = [
      vendor("vercel", "Vercel", [{ kind: "plan", metric: "plan", label: "Plan", value: "Hobby", numeric: null, unit: null }]),
      vendor("supabase", "Supabase", [
        { kind: "plan", metric: "plan", label: "Plan", value: "Free", numeric: null, unit: null },
        { kind: "usage", metric: "db_size_mb", label: "Database size", value: "450 MB", numeric: 450, unit: "MB" },
      ]),
    ];

    const { drafts, checked } = appAlerts({ app: { name: "Cockpit", environments: ["production"] }, projects, map, reads, vendors, deadlines, now: NOW });
    const byKey = new Map(drafts.map((d) => [d.dedupeKey, d]));

    expect(byKey.get("deployment_failed:p-web:dpl_new")?.sentence).toBe(
      'The newest production deployment of the Vercel project cockpit failed 2 hours ago (commit bbb2222, "Add the digest"): Vercel says "Command "npm run build" exited with 1". Production still serves the deployment from 17 October 2026, so the changes in it are not live.',
    );
    expect(byKey.get("cron_missing:p-web:/api/cron/digest")?.sentence).toBe(
      "The cron /api/cron/digest, set to run every 15 minutes at vercel.json:5, is not registered on the Vercel project cockpit. Vercel registers crons from vercel.json when a production deployment succeeds, so it does not run until one does.",
    );
    expect(byKey.get("env_missing:p-web:production:CRON_SECRET")?.sentence).toMatch(/^CRON_SECRET is not set for production on the Vercel project cockpit, which serves the app deployment\. The code reads it at src\/app\/api\/cron\/.+ without a default, so in production that read finds nothing\.$/);
    // The ops deployment needs its own names and the role name, and nothing of the product's crons or webhooks.
    expect(drafts.filter((d) => d.kind === "env_missing" && d.projectId === "p-ops").map((d) => d.details["name"])).toEqual(["DEV_USER_IDS"]);
    expect(byKey.get("deadline:p-web:key:2026-10-23")).toMatchObject({ severity: "critical", sentence: "The key birdsI reads the Vercel project cockpit with expires on 23 October 2026, in 5 days. After that Vercel refuses it, and the project goes unread." });
    expect(byKey.get("migration_owed:p-db:0002_social.sql")?.sentence).toBe(
      "The database of the Supabase project cockpit-db has not run 0002_social.sql: the table follows, marked for it in supabase/verify.sql, is not in the database (1 marker of 3 missing in all). Code that uses it fails until the file is run.",
    );
    expect(byKey.get("plan_limit:p-push:mobile_suppressed")).toMatchObject({ severity: "critical" });
    expect(byKey.get("plan_limit:supabase:db_size_mb")?.sentence).toBe("Supabase database size is 450 MB, 90% of the 500 MB the Free plan includes. Going past a quota: Supabase notifies you, then restricts the service.");
    expect(byKey.get("plan_limit:vercel:cron:/api/cron/digest")?.sentence).toBe(
      'The cron /api/cron/digest runs 96 times a day (every 15 minutes, vercel.json:5), and Vercel\'s Hobby plan allows 1 run a day: "Hobby accounts are limited to cron jobs that run once per day. Cron expressions that would run more frequently will fail during deployment."',
    );
    expect(byKey.get("deadline:app:d1:2026-10-28")?.sentence).toBe("The OneSignal trial ends (OneSignal) is on 28 October 2026, in 10 days, as you noted on 1 October 2026. After it the plan is Free.");
    expect(checked).toEqual(expect.arrayContaining(["deployment_failed:p-web", "cron_missing:p-web", "env_missing:p-ops", "migration_owed:p-db", "project_paused:p-db", "plan_limit:p-push", "plan_limit:supabase", "plan_limit:vercel", "deadline:p-web", "deadline:app"]));
    // Critical first.
    expect(drafts[0]!.severity).toBe("critical");
    // Every alert names where its evidence is.
    for (const d of drafts) expect(d.source.url ?? d.source.path ?? d.source.label).toBeTruthy();
  });

  it("says when a project could not be read at all, and checks nothing else of it", () => {
    const failed = (reason: string) => ({ ok: false as const, readAt: "2026-10-18T20:00:00.000Z", source: { api: "x", page: null }, reason });
    const read: VercelRead = { vendor: "vercel", project: failed("Vercel refused the key (HTTP 401). It may have expired or been revoked. Replace it on the Projects page."), deployments: failed("Not read"), env: failed("Not read"), crons: failed("Not read"), domains: failed("Not read"), errors: failed("Not read"), keyExpiry: failed("Not read") };
    const { drafts, checked } = appAlerts({ app: { name: "Cockpit", environments: ["production"] }, projects: [projects[0]!], map, reads: new Map([["p-web", read]]), vendors: [], deadlines: [], now: NOW });
    expect(drafts).toEqual([expect.objectContaining({ kind: "read_failed", sentence: "birdsI could not read the Vercel project cockpit (product) an hour ago: Vercel refused the key (HTTP 401). It may have expired or been revoked. Replace it on the Projects page. Nothing on this project is current until it can." })]);
    expect(checked).not.toContain("env_missing:p-web");
  });

  it("says Supabase paused the project, with the plan's own rule", () => {
    const read: SupabaseRead = {
      vendor: "supabase",
      project: { ok: true, ...at("https://supabase.com/dashboard/project/abcdefghijklmnopqrst"), value: { ref: "abcdefghijklmnopqrst", name: "lamp-post", region: null, status: "INACTIVE", paused: true, createdAt: null, postgresVersion: null } },
      size: { ok: false, readAt: NOW.toISOString(), source: { api: "x", page: null }, reason: "Not read: the project is paused." },
      security: { ok: false, readAt: NOW.toISOString(), source: { api: "x", page: null }, reason: "Not read: the project is paused." },
      performance: { ok: false, readAt: NOW.toISOString(), source: { api: "x", page: null }, reason: "Not read: the project is paused." },
      migrations: { ok: false, readAt: NOW.toISOString(), source: { api: "x", page: null }, reason: "Not read: the project is paused." },
    };
    const vendors = [vendor("supabase", "Supabase", [{ kind: "plan", metric: "plan", label: "Plan", value: "Free", numeric: null, unit: null }])];
    const { drafts } = appAlerts({ app: { name: "Lamp Post", environments: ["production"] }, projects: [projects[2]!], map, reads: new Map([["p-db", read]]), vendors, deadlines: [], now: NOW });
    expect(drafts.find((d) => d.kind === "project_paused")?.sentence).toBe('Supabase paused the project lamp-post that Lamp Post runs on (on the Free plan, "Free projects are paused after 1 week of inactivity"). Until it is restored, Lamp Post\'s database does not answer.');
  });
});
