import { describe, expect, it } from "vitest";
import { envNeededBy, mapCountsLine, missingEnv, roleForLabel, type MapEnv, type ServiceMap } from "./map";

const roles = { envName: "APP_ROLE", defaultRole: "app", names: ["app", "ops", "school"], sources: [] };

function env(name: string, areas: string[], extra: Partial<MapEnv> = {}): MapEnv {
  return { name, alternatives: [], public: false, service: null, declared: null, note: null, optional: false, optionalWhy: null, areas, roles: [], reads: [], ...extra };
}

const map: Pick<ServiceMap, "env" | "roles"> = {
  roles,
  env: [
    env("APP_ROLE", ["shared"]),
    env("CRON_SECRET", ["cron"]),
    env("STRIPE_WEBHOOK_SECRET", ["webhook"]),
    env("DEV_USER_IDS", ["ops"]),
    env("SCHOOL_INVITE_SECRET", ["school"]),
    env("SUPABASE_SECRET_KEY", ["shared"], { alternatives: ["SUPABASE_SERVICE_ROLE_KEY"] }),
    env("SUPABASE_SERVICE_ROLE_KEY", ["shared"], { alternatives: ["SUPABASE_SECRET_KEY"] }),
    env("NEXT_PUBLIC_CLARITY_ID", ["app"], { optional: true, optionalWhy: "Every read in the code has a default value." }),
    env("OLD_FLAG", ["unreached"]),
  ],
};

describe("what each deployment needs", () => {
  it("gives the product every name its routes, crons and webhooks reach, never the role name", () => {
    const needed = envNeededBy(map, "app");
    expect(needed.required.map((e) => e.name).sort()).toEqual(["CRON_SECRET", "STRIPE_WEBHOOK_SECRET", "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"]);
    expect(needed.optional.map((e) => e.name)).toEqual(["NEXT_PUBLIC_CLARITY_ID"]);
    expect(needed.shared).toEqual([]);
  });

  it("gives another deployment its own names and the role name, with shared code apart", () => {
    const needed = envNeededBy(map, "ops");
    expect(needed.required.map((e) => e.name).sort()).toEqual(["APP_ROLE", "DEV_USER_IDS"]);
    expect(needed.shared.map((e) => e.name).sort()).toEqual(["SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"]);
  });

  it("counts a name as present when its alternative is set", () => {
    const needed = envNeededBy(map, "app").required;
    expect(missingEnv(needed, new Set(["CRON_SECRET", "STRIPE_WEBHOOK_SECRET", "SUPABASE_SERVICE_ROLE_KEY"]))).toEqual([]);
    expect(missingEnv(needed, new Set(["CRON_SECRET"])).map((e) => e.name).sort()).toEqual(["STRIPE_WEBHOOK_SECRET", "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"]);
  });
});

describe("the deployment a project serves, from its label", () => {
  it("matches a role in any case, singular or plural, or as one word of the label", () => {
    expect(roleForLabel("ops", roles)).toBe("ops");
    expect(roleForLabel("Schools", roles)).toBe("school");
    expect(roleForLabel("flowsophy-ops", roles)).toBe("ops");
    expect(roleForLabel("product", roles)).toBe("app");
    expect(roleForLabel(null, roles)).toBe("app");
  });

  it("falls back to the product when a label names two deployments", () => {
    expect(roleForLabel("ops for schools", roles)).toBe("app");
  });
});

describe("the map's totals", () => {
  it("reads as one line, with the deployments when there are several", () => {
    expect(mapCountsLine({ services: 12, envNames: 38, crons: 2, webhooks: 3, storeApps: 1, migrations: 73, roles: ["app", "ops", "school"] })).toBe(
      "12 services, 38 env names, 2 crons, 3 webhooks, 1 store app, 73 migration files. Deployments: app, ops, school",
    );
    expect(mapCountsLine({ services: 1, envNames: 1, crons: 0, webhooks: 0, storeApps: 0, migrations: 0, roles: [] })).toBe("1 service, 1 env name, 0 crons, 0 webhooks, 0 store apps, 0 migration files");
  });
});
