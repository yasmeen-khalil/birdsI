import { describe, expect, it } from "vitest";
import type { MapCron, MapEnv, MapService, MapWebhook, ServiceMap, SourceLine } from "@birdsi/shared";
import { findGaps } from "./gaps";

const at = (path: string, line = 1, text = ""): SourceLine => ({ path, line, text });

function service(over: Partial<MapService> & Pick<MapService, "slug" | "name" | "category">): MapService {
  return { how: ["package"], packages: [], imports: [], envNames: [], sources: [], dashboardUrl: null, pricingUrl: null, checkedLimits: false, purpose: null, found: null, ...over };
}

function env(name: string, over: Partial<MapEnv> = {}): MapEnv {
  return { name, alternatives: [], public: false, service: null, declared: null, note: null, optional: false, optionalWhy: null, areas: ["shared"], roles: [], reads: [], found: null, ...over };
}

function cron(over: Partial<MapCron> & Pick<MapCron, "path">): MapCron {
  return { schedule: "0 4 * * *", every: "every day at 04:00 UTC", perDay: 1, source: at("vercel.json", 4), handler: "src/app/api/cron/x/route.ts", checksSecret: true, kind: "vercel", found: null, ...over };
}

function webhook(over: Partial<MapWebhook> & Pick<MapWebhook, "route" | "file">): MapWebhook {
  return { service: null, verifies: at(over.file, 10, "constructEvent("), methods: ["POST"], found: null, ...over };
}

function map(over: Partial<ServiceMap> = {}): ServiceMap {
  return {
    version: 1,
    readAt: "2026-10-27T00:00:00.000Z",
    commit: null,
    branch: null,
    units: [{ path: "", name: "app", framework: "Next.js" }],
    services: [],
    env: [],
    roles: { envName: null, defaultRole: null, names: [], sources: [] },
    crons: [],
    webhooks: [],
    storeApps: [],
    migrations: { style: null, dir: null, files: [], verify: null, record: null },
    publicSurface: { sitemap: null, robots: null, llmsTxt: null },
    counts: { files: 10, packages: 3, routes: 2 },
    reader: null,
    modelFinds: [],
    fileHashes: {},
    ...over,
  };
}

const base = { runtimeDependencies: [], importedPackages: new Set<string>(), unreached: [], hasEntries: true };

describe("findGaps", () => {
  it("says nothing about a map with nothing missing", () => {
    const m = map({
      crons: [cron({ path: "/api/cron/x" })],
      webhooks: [webhook({ route: "/api/webhooks/stripe", file: "src/app/api/webhooks/stripe/route.ts", service: "stripe" })],
      services: [service({ slug: "stripe", name: "Stripe", category: "payments", packages: ["stripe"] })],
      env: [env("STRIPE_SECRET_KEY", { service: "stripe" })],
    });
    expect(findGaps({ ...base, map: m, importedPackages: new Set(["stripe"]) })).toEqual([]);
  });

  it("flags a Vercel cron with no handler, and one whose handler never reads the secret", () => {
    const m = map({ crons: [cron({ path: "/api/cron/ghost", handler: null }), cron({ path: "/api/cron/open", handler: "src/app/api/cron/open/route.ts", checksSecret: false }), cron({ path: "nightly", kind: "actions", handler: null, checksSecret: false })] });
    const found = findGaps({ ...base, map: m });
    expect(found.map((f) => [f.title, f.severity, f.category])).toEqual([
      ["The cron /api/cron/ghost has no handler in the code", "medium", "gap"],
      ["The cron handler src/app/api/cron/open/route.ts does not check CRON_SECRET", "high", "security"],
    ]);
    expect(found[0]!.location).toEqual({ path: "vercel.json", lineStart: 4 });
    expect(found.every((f) => f.confidence === "proven")).toBe(true);
  });

  it("flags a webhook with no line that checks the sender", () => {
    const m = map({ webhooks: [webhook({ route: "/api/webhooks/clerk", file: "src/app/api/webhooks/clerk/route.ts", service: "clerk", verifies: null })] });
    const [f] = findGaps({ ...base, map: m });
    expect(f).toMatchObject({ title: "The webhook /api/webhooks/clerk does not check who sent the request", severity: "high", category: "security", location: { path: "src/app/api/webhooks/clerk/route.ts" } });
  });

  it("flags an SDK in use with no key named, and leaves hosting vendors alone", () => {
    const m = map({
      services: [service({ slug: "stripe", name: "Stripe", category: "payments", packages: ["stripe"], imports: [at("src/lib/pay.ts", 3, 'import Stripe from "stripe"')] }), service({ slug: "vercel", name: "Vercel", category: "hosting", how: ["config"] })],
      env: [env("RESEND_API_KEY", { service: "resend" })],
    });
    const found = findGaps({ ...base, map: m });
    expect(found.map((f) => f.title)).toEqual(["The code uses Stripe but no Stripe key is named anywhere"]);
    expect(found[0]).toMatchObject({ severity: "medium", category: "gap", location: { path: "src/lib/pay.ts", lineStart: 3 } });
  });

  it("flags an env name declared but never read, unless an SDK could be reading it", () => {
    const m = map({
      env: [
        env("OLD_FLAG", { areas: ["declared"], declared: at(".env.example", 7, "OLD_FLAG=") }),
        env("CLERK_SECRET_KEY", { areas: ["declared"], declared: at(".env.example", 2, "CLERK_SECRET_KEY="), service: "clerk" }),
        env("USED", { areas: ["shared"], declared: at(".env.example", 3, "USED=") }),
      ],
    });
    const found = findGaps({ ...base, map: m });
    expect(found.map((f) => f.title)).toEqual(["OLD_FLAG is in .env.example but nothing in the code reads it"]);
    expect(found[0]).toMatchObject({ severity: "low", category: "stale", location: { path: ".env.example", lineStart: 7 } });
  });

  it("lists runtime packages nothing imports, leaving tooling out", () => {
    const deps = ["left-pad", "lodash", "eslint", "typescript", "next", "stripe"].map((name) => ({ name, manifestPath: "package.json" }));
    const found = findGaps({ ...base, map: map(), runtimeDependencies: deps, importedPackages: new Set(["stripe"]) });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ title: "2 packages are listed in package.json but never imported", severity: "low", category: "redundancy" });
    expect(found[0]!.explanation.startsWith("left-pad, lodash:")).toBe(true);
  });

  it("lists files no entry reaches, only when the app has entries", () => {
    const unreached = ["src/lib/old.ts", "src/lib/older.ts"];
    const found = findGaps({ ...base, map: map(), unreached });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ title: "2 files are not reached from any page, route or entry", severity: "low", category: "stale", location: { path: "src/lib/old.ts" } });
    expect(findGaps({ ...base, map: map(), unreached, hasEntries: false })).toEqual([]);
  });

  it("flags two services for one job, and not two databases", () => {
    const m = map({
      services: [
        service({ slug: "resend", name: "Resend", category: "email", how: ["env"] }),
        service({ slug: "sendgrid", name: "SendGrid", category: "email", how: ["env"] }),
        service({ slug: "supabase", name: "Supabase", category: "database", how: ["env"] }),
        service({ slug: "upstash", name: "Upstash", category: "database", how: ["env"] }),
      ],
    });
    const found = findGaps({ ...base, map: m });
    expect(found.map((f) => f.title)).toEqual(["2 services for email: Resend and SendGrid"]);
    expect(found[0]).toMatchObject({ severity: "low", category: "redundancy", actionKind: "steps" });
  });
});
