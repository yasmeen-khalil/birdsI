import { describe, expect, it } from "vitest";
import type { AppProject } from "./apps";
import { checklistView, type ChecklistInput } from "./checklist";
import type { StoredMap } from "./map";

function project(over: Partial<AppProject> & Pick<AppProject, "vendor" | "kind" | "ref">): AppProject {
  return { id: `p-${over.ref}`, appId: "app", label: null, environment: null, plan: null, settings: {}, dashboardUrl: "https://example.test", key: null, createdAt: "2026-10-27T00:00:00.000Z", ...over };
}

const key = (lastStatus: "ok" | "failed" | null, lastError: string | null = null) => ({ id: "k", label: null, scope: "read" as const, fingerprint: null, sharedWith: [], lastReadAt: lastStatus ? "2026-10-27T01:00:00.000Z" : null, lastStatus, lastError, createdAt: "2026-10-27T00:00:00.000Z" });

function stored(services: Array<{ slug: string; name: string }>, reader = false): StoredMap {
  return {
    appId: "app",
    repoId: "repo",
    scanId: null,
    createdAt: "2026-10-27T10:00:00.000Z",
    map: {
      version: 1,
      readAt: "2026-10-27T10:00:00.000Z",
      commit: "abc1234def",
      branch: "main",
      units: [],
      services: services.map((s) => ({ ...s, category: "other", how: ["package" as const], packages: [], imports: [], envNames: [], sources: [], dashboardUrl: `https://${s.slug}.example`, pricingUrl: null, checkedLimits: false, purpose: null, found: null })),
      env: [],
      roles: { envName: null, defaultRole: null, names: [], sources: [] },
      crons: [],
      webhooks: [],
      storeApps: [],
      migrations: { style: null, dir: null, files: [], verify: null, record: null },
      publicSurface: { sitemap: null, robots: null, llmsTxt: null },
      counts: { files: 1, packages: 1, routes: 1 },
      reader: reader ? { model: "nano", filesRead: 10, filesUnchanged: 0, filesSkipped: 0, filesOverBudget: 0, batches: 1, finds: 2, confirmed: 2, dropped: 0, known: 0, carried: 0 } : null,
      modelFinds: [],
      fileHashes: {},
    },
  };
}

function input(over: Partial<ChecklistInput> = {}): ChecklistInput {
  return { appName: "Cockpit", appReady: true, projects: [], untiedKeys: [], map: null, scope: null, email: { on: false, sentence: "Alerts are not emailed: RESEND_API_KEY is not set on birdsI." }, deadlines: 0, ...over };
}

describe("checklistView", () => {
  it("starts with the map, and says what the terminal command does", () => {
    const view = checklistView(input());
    expect(view.items[0]).toMatchObject({ id: "map", status: "todo", required: true });
    expect(view.items[0]!.steps[0]).toContain("npx birdsi");
    expect(view.complete).toBe(false);
    expect(view.required.total).toBe(2);
  });

  it("lists each readable service with its project and key, the clicks and what birdsI will read", () => {
    const view = checklistView(input({ map: stored([{ slug: "vercel", name: "Vercel" }, { slug: "clerk", name: "Clerk" }, { slug: "posthog", name: "PostHog" }]) }));
    const ids = view.items.map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(["vercel-project", "vercel-key", "clerk-project", "unreadable", "email", "dates", "agent"]));
    const vercelKey = view.items.find((i) => i.id === "vercel-key")!;
    expect(vercelKey).toMatchObject({ status: "todo", required: true, state: "Declare the project first." });
    expect(vercelKey.steps[0]).toContain("Account Settings > Tokens");
    expect(vercelKey.willDo).toContain("deployments");
    expect(vercelKey.links[0]!.url).toBe("https://vercel.com/account/settings/tokens");
    // Clerk reads since v4 step 8, so its project and key are required steps with the clicks and what the key lets birdsI read.
    const clerk = view.items.find((i) => i.id === "clerk-project")!;
    expect(clerk).toMatchObject({ status: "todo", required: true });
    const clerkKey = view.items.find((i) => i.id === "clerk-key")!;
    expect(clerkKey.steps[0]).toContain("Secret keys");
    expect(clerkKey.willDo).toContain("organizations");
    expect(view.items.find((i) => i.id === "unreadable")!.state).toContain("PostHog");
    expect(view.items.find((i) => i.id === "reader")).toMatchObject({ status: "todo", required: false });
  });

  it("marks declared projects and working keys done, and a failed key as failed", () => {
    const projects = [project({ vendor: "vercel", kind: "project", ref: "shop", label: "product", key: key("ok") }), project({ vendor: "vercel", kind: "project", ref: "shop-ops", label: "ops", key: key("failed", "Vercel did not accept the token.") }), project({ vendor: "supabase", kind: "project", ref: "abcdefghijklmnopqrst", key: key("ok") })];
    const view = checklistView(input({ map: stored([{ slug: "vercel", name: "Vercel" }, { slug: "supabase", name: "Supabase" }], true), projects, email: { on: true, sentence: "New alerts are emailed to y***@example.com." }, deadlines: 2 }));
    expect(view.items.find((i) => i.id === "vercel-project")).toMatchObject({ status: "done" });
    const vercelKey = view.items.find((i) => i.id === "vercel-key")!;
    expect(vercelKey.status).toBe("failed");
    expect(vercelKey.state).toContain("ops (Vercel did not accept the token.)");
    expect(view.items.find((i) => i.id === "supabase-key")).toMatchObject({ status: "done" });
    expect(view.items.find((i) => i.id === "reader")).toMatchObject({ status: "done" });
    expect(view.items.find((i) => i.id === "email")).toMatchObject({ status: "done" });
    expect(view.items.find((i) => i.id === "dates")).toMatchObject({ status: "done" });
    expect(view.complete).toBe(false);
    expect(view.required).toEqual({ done: 5, total: 6 });
  });

  it("is complete when every required step is done, and blocked before the apps migration", () => {
    const projects = [project({ vendor: "supabase", kind: "project", ref: "abcdefghijklmnopqrst", key: key("ok") })];
    const done = checklistView(input({ map: stored([{ slug: "supabase", name: "Supabase" }]), projects }));
    expect(done.complete).toBe(true);
    expect(done.required).toEqual({ done: 4, total: 4 });
    const blocked = checklistView(input({ appReady: false, map: stored([]) }));
    expect(blocked.items.find((i) => i.id === "app")).toMatchObject({ status: "blocked", required: true });
    expect(blocked.complete).toBe(false);
  });

  it("asks to tie keys from before keys belonged to projects", () => {
    const view = checklistView(input({ map: stored([]), untiedKeys: [{ id: "u", vendor: "vercel", vendorName: "Vercel", settings: {}, lastStatus: "ok", lastError: null, createdAt: "2026-10-01T00:00:00.000Z" }] }));
    expect(view.items.find((i) => i.id === "untied")).toMatchObject({ status: "todo", required: true });
  });
});
