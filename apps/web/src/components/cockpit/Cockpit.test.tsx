import { resolve } from "node:path";
import { renderToString } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { buildServiceMap, collectDependencies, discoverVendors, walkInventory } from "@birdsi/engine";
import { cockpitView, type AppAlert, type StoredMap } from "@birdsi/shared";
import { CockpitSections } from "./Cockpit";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

let stored: StoredMap;

beforeAll(async () => {
  const fixture = resolve(import.meta.dirname, "../../../../../packages/engine/fixtures/cockpit-app");
  const inventory = await walkInventory(fixture);
  const deps = await collectDependencies(inventory);
  const map = await buildServiceMap(inventory, deps, await discoverVendors(inventory, deps, null), { commit: "abc1234def", branch: "main", readAt: "2026-10-18T12:00:00.000Z" });
  stored = { appId: "a", repoId: "r", scanId: "s", createdAt: "2026-10-18T12:00:00.000Z", map };
});

const email = { on: false, sentence: "Alerts are not emailed: RESEND_API_KEY is not set on birdsI." };

describe("the cockpit page", () => {
  it("renders an app from its map alone, with every section of the code and the vendors to declare", () => {
    const view = cockpitView({ appName: "Lamp Post", environments: ["production"], projects: [], map: stored, mapReason: null, reads: new Map(), readsReason: null, alerts: [], alertsReason: null, email, vendors: [] });
    const html = renderToString(<CockpitSections view={view} repoId="r1" />);
    expect(html).toContain("Nothing needs you");
    expect(html).toContain("RESEND_API_KEY is not set on birdsI");
    expect(html).toContain("The code uses ");
    for (const text of ["Services", "Crons", "/api/cron/purge-deleted", "every day at 04:00 UTC", "checks CRON_SECRET", "Webhooks", "/api/stripe/webhook", "Store apps", "com.example.cockpit", "Migrations", "0002_social.sql", "Public pages"]) expect(html).toContain(text);
    expect(html).not.toContain("Deployments");
    for (const text of ["Services and dependencies", "The last map", "Security", "Money", "No model read the code"]) expect(html).toContain(text);
  });

  it("shows an open alert with its sentence and what to do", () => {
    const alert: AppAlert = {
      id: "al1",
      appId: "a",
      kind: "migration_owed",
      severity: "warning",
      projectId: null,
      sentence: "The database of the Supabase project cockpit-db has not run 0002_social.sql.",
      action: "Run supabase/migrations/0002_social.sql in the Supabase SQL editor.",
      details: {},
      source: { label: "The Supabase SQL editor", url: "https://supabase.com/dashboard/project/x/sql/new", path: null, line: null },
      dedupeKey: "migration_owed:p:0002_social.sql",
      scope: "migration_owed:p",
      openedAt: "2026-10-18T20:00:00.000Z",
      seenAt: "2026-10-18T21:00:00.000Z",
      resolvedAt: null,
      emailStatus: "not sent: RESEND_API_KEY is not set on birdsI.",
      emailedAt: null,
    };
    const view = cockpitView({ appName: "Cockpit", environments: ["production"], projects: [], map: null, mapReason: "No service map of this app yet.", reads: new Map(), readsReason: null, alerts: [alert], alertsReason: null, email, vendors: [] });
    const html = renderToString(<CockpitSections view={view} repoId="r1" />);
    expect(html).toContain("1 alert open");
    expect(html).toContain("has not run 0002_social.sql");
    expect(html).toContain("Run supabase/migrations/0002_social.sql");
    expect(html).toContain("No service map of this app yet.");
  });
});
