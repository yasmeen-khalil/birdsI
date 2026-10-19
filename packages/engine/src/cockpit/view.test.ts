import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { cockpitView, type AppProject, type ProjectRead, type ServiceMap, type StoredMap, type VercelRead } from "@birdsi/shared";
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
