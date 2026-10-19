import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { envNeededBy, missingEnv } from "@birdsi/shared";
import { collectDependencies } from "../inventory/manifests";
import { walkInventory } from "../inventory/walk";
import { discoverVendors } from "../vendors/discover";
import { buildServiceMap, describeSchedule, parseMarkers } from "./index";

const fixture = resolve(import.meta.dirname, "../../fixtures/cockpit-app");

async function mapFixture() {
  const inventory = await walkInventory(fixture);
  const deps = await collectDependencies(inventory);
  const vendors = await discoverVendors(inventory, deps, null);
  return buildServiceMap(inventory, deps, vendors, { commit: "abc1234", branch: "main", readAt: "2026-10-18T12:00:00.000Z" });
}

describe("the service map of the fixture app", () => {
  it("finds the services with the SDK imports, and keeps the file and line of each", async () => {
    const map = await mapFixture();
    expect(map.services.map((s) => s.slug)).toEqual(expect.arrayContaining(["clerk", "onesignal", "resend", "revenuecat", "stripe", "supabase", "vercel"]));
    const stripe = map.services.find((s) => s.slug === "stripe")!;
    expect(stripe.how).toContain("import");
    expect(stripe.imports[0]).toMatchObject({ path: "src/app/api/stripe/webhook/route.ts", line: 1 });
    expect(stripe.checkedLimits).toBe(true);
    expect(map.commit).toBe("abc1234");
  });

  it("reads the deployment roles and which role reaches each env name", async () => {
    const map = await mapFixture();
    expect(map.roles).toMatchObject({ envName: "APP_ROLE", defaultRole: "app", names: ["app", "ops"] });
    const env = new Map(map.env.map((e) => [e.name, e]));
    expect(env.get("DEV_USER_IDS")?.areas).toEqual(["ops"]);
    expect(env.get("CRON_SECRET")?.areas).toEqual(["cron"]);
    expect(env.get("STRIPE_WEBHOOK_SECRET")?.areas).toEqual(["webhook"]);
    expect(env.get("STRIPE_WEBHOOK_SECRET")?.optional).toBe(true);
    expect(env.get("STRIPE_WEBHOOK_SECRET")?.optionalWhy).toMatch(/Inert until set/);
    expect(env.get("CLERK_SECRET_KEY")?.areas).toEqual(["declared"]);
    expect(env.get("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY")?.public).toBe(true);
    // Never a value: an example line keeps the name only.
    expect(env.get("APP_ROLE")?.declared?.text).toBe("APP_ROLE=");
  });

  it("says what each deployment needs, and what a project lacks", async () => {
    const map = await mapFixture();
    const product = envNeededBy(map, "app");
    expect(product.required.map((e) => e.name)).toEqual(expect.arrayContaining(["CRON_SECRET", "CLERK_WEBHOOK_SECRET", "SUPABASE_SECRET_KEY", "CLERK_SECRET_KEY"]));
    expect(product.required.map((e) => e.name)).not.toContain("APP_ROLE");
    expect(product.required.map((e) => e.name)).not.toContain("DEV_USER_IDS");
    const ops = envNeededBy(map, "ops");
    expect(ops.required.map((e) => e.name)).toEqual(expect.arrayContaining(["APP_ROLE", "DEV_USER_IDS"]));
    expect(ops.required.map((e) => e.name)).not.toContain("CRON_SECRET");
    const missing = missingEnv(product.required, new Set(["CLERK_SECRET_KEY", "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "CLERK_WEBHOOK_SECRET", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY"]));
    expect(missing.map((e) => e.name)).toEqual(["CRON_SECRET"]);
  });

  it("reads the crons with their handlers, the webhooks with their senders, the store app, the migrations and the public pages", async () => {
    const map = await mapFixture();
    expect(map.crons).toEqual([
      expect.objectContaining({ path: "/api/cron/purge-deleted", every: "every day at 04:00 UTC", perDay: 1, handler: "src/app/api/cron/purge-deleted/route.ts", checksSecret: true, source: expect.objectContaining({ path: "vercel.json", line: 4 }) }),
      expect.objectContaining({ path: "/api/cron/digest", every: "every 15 minutes", perDay: 96 }),
    ]);
    expect(map.webhooks.map((w) => [w.route, w.service, Boolean(w.verifies)])).toEqual([
      ["/api/stripe/webhook", "stripe", true],
      ["/api/webhooks/clerk", "clerk", true],
      ["/api/webhooks/revenuecat", "revenuecat", true],
    ]);
    expect(map.webhooks[0]!.verifies?.text).toContain("constructEvent");
    expect(map.webhooks[1]!.verifies?.text).toContain(".verify(");
    expect(map.storeApps).toEqual([expect.objectContaining({ platform: "capacitor", bundleId: "com.example.cockpit", appName: "Cockpit", webUrl: "https://cockpit.example.com" })]);
    expect(map.migrations.style).toBe("numbered");
    expect(map.migrations.files.map((f) => f.name)).toEqual(["0001_init.sql", "0002_social.sql"]);
    expect(map.migrations.verify?.markers).toHaveLength(3);
    expect(map.publicSurface.sitemap?.path).toBe("src/app/sitemap.ts");
    expect(map.publicSurface.llmsTxt?.path).toBe("public/llms.txt");
  });
});

describe("cron schedules in words", () => {
  it("says how often, and how many times a day", () => {
    expect(describeSchedule("0 4 * * *")).toEqual({ every: "every day at 04:00 UTC", perDay: 1 });
    expect(describeSchedule("*/15 * * * *")).toEqual({ every: "every 15 minutes", perDay: 96 });
    expect(describeSchedule("30 * * * *")).toEqual({ every: "every hour at minute 30", perDay: 24 });
    expect(describeSchedule("0 */6 * * *")).toEqual({ every: "every 6 hours at minute 0", perDay: 4 });
    expect(describeSchedule("0 9,21 * * *")).toEqual({ every: "every day at 09:00, 21:00 UTC", perDay: 2 });
    expect(describeSchedule("0 8 * * 1").every).toBe("every Monday at 08:00 UTC");
    expect(describeSchedule("0 0 1-7 * *")).toEqual({ every: "on the schedule 0 0 1-7 * *", perDay: null });
  });
});

describe("verify.sql markers", () => {
  it("reads the marker rows, quotes and nulls included", () => {
    const markers = parseMarkers(`with markers (migration, kind, name, col) as (
      values
        ('v2 favorites', 'table', 'favorites', null),
        ('v18 save dedup', 'column', 'flowcharts', 'source_share_id'),
        ('v70 promo keeps pro', 'comment', 'redeem_promo', 'v70'),
        ('0011 no ip: the owner''s list', 'no_table', 'banned_ips', null)
    ) select 1`);
    expect(markers).toEqual([
      { migration: "v2 favorites", kind: "table", name: "favorites", col: null },
      { migration: "v18 save dedup", kind: "column", name: "flowcharts", col: "source_share_id" },
      { migration: "v70 promo keeps pro", kind: "comment", name: "redeem_promo", col: "v70" },
      { migration: "0011 no ip: the owner's list", kind: "no_table", name: "banned_ips", col: null },
    ]);
  });
});
