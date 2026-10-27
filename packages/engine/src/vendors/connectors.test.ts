import { generateKeyPairSync, verify } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appleToken, CONNECTOR_BY_SLUG } from "./connectors";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the Stripe connector", () => {
  it("reads every page of the month's charges and takes refunds off", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        calls.push(url);
        if (url.includes("/v1/balance")) return json({ available: [{ amount: 1000, currency: "usd" }], pending: [], livemode: true });
        if (url.includes("starting_after=ch_2")) return json({ data: [{ id: "ch_3", amount: 3000, amount_refunded: 0, paid: true }], has_more: false });
        return json({ data: [{ id: "ch_1", amount: 2000, amount_refunded: 500, paid: true }, { id: "ch_2", amount: 900, paid: false }], has_more: true });
      }),
    );
    const facts = await CONNECTOR_BY_SLUG.get("stripe")!.probe("rk_test", {});
    const revenue = facts.find((f) => f.metric === "revenue_month");
    expect(revenue?.numeric).toBe(45);
    expect(revenue?.value).toBe("45.00 USD");
    expect(facts.find((f) => f.metric === "charges_month")?.numeric).toBe(2);
    expect(calls.filter((u) => u.includes("/v1/charges"))).toHaveLength(2);
  });
});

describe("the Vercel connector", () => {
  it("never assumes a plan for an account read without a team id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes("/v2/user")) return json({ user: { username: "owner" } });
        if (url.includes("/v9/projects")) return json({ projects: [{ name: "app" }] });
        return json({}, 404);
      }),
    );
    const facts = await CONNECTOR_BY_SLUG.get("vercel")!.probe("token", {});
    expect(facts.some((f) => f.kind === "plan")).toBe(false);
    expect(facts.find((f) => f.metric === "plan_access")?.value).toMatch(/Not read/);
  });
});

describe("keys scoped to one project", () => {
  it("a Vercel key scoped to the project is accepted, and says why the plan was not read", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes("/v9/projects/flowsophy-ops")) return json({ id: "prj_ops", name: "flowsophy-ops" });
        if (url.includes("/v2/teams/team_abc")) return json({ error: { code: "forbidden" } }, 403);
        return json({}, 404);
      }),
    );
    const facts = await CONNECTOR_BY_SLUG.get("vercel")!.probe("vcp_x", { teamId: "team_abc", project: "flowsophy-ops" });
    expect(facts).toEqual([expect.objectContaining({ metric: "plan_access", value: expect.stringContaining("scoped to the project") })]);
  });

  it("a Vercel key that cannot read the project is refused", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({}, 403)));
    await expect(CONNECTOR_BY_SLUG.get("vercel")!.probe("vcp_x", { teamId: "team_abc", project: "flowsophy-ops" })).rejects.toThrow(/did not accept the token/);
  });

  it("a Supabase key scoped to the project reads its status, the plan when allowed, and the size from the catalog", async () => {
    const queries: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/v1/projects/abcdefghijklmnopqrst")) return json({ ref: "abcdefghijklmnopqrst", name: "flowsophy", status: "ACTIVE_HEALTHY", organization_slug: "flowsophy-org" });
        if (url.endsWith("/v1/organizations/flowsophy-org")) return json({ id: "org", name: "Flowsophy", plan: "pro" });
        if (url.endsWith("/database/query/read-only")) {
          queries.push(String(JSON.parse(String(init?.body)).query));
          return json([{ bytes: 524_288_000 }], 201);
        }
        return json({}, 404);
      }),
    );
    const facts = await CONNECTOR_BY_SLUG.get("supabase")!.probe("sbp_x", { projectRef: "abcdefghijklmnopqrst" });
    expect(facts.find((f) => f.metric === "plan")?.value).toBe("Pro");
    expect(facts.find((f) => f.metric === "project_status")?.value).toBe("Running");
    expect(facts.find((f) => f.metric === "db_size_mb")).toMatchObject({ numeric: 500, unit: "MB" });
    expect(queries).toEqual(["select pg_catalog.pg_database_size(pg_catalog.current_database())::bigint as bytes"]);
  });

  it("a paused Supabase project is said to be paused, and no query runs", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        urls.push(url);
        if (url.endsWith("/v1/projects/abcdefghijklmnopqrst")) return json({ ref: "abcdefghijklmnopqrst", name: "lamp-post", status: "INACTIVE", organization_slug: "o" });
        if (url.endsWith("/v1/organizations/o")) return json({ plan: "free" });
        return json({}, 404);
      }),
    );
    const facts = await CONNECTOR_BY_SLUG.get("supabase")!.probe("sbp_x", { projectRef: "abcdefghijklmnopqrst" });
    expect(facts.find((f) => f.metric === "project_status")?.value).toBe("Paused");
    expect(facts.find((f) => f.metric === "paused_projects")?.value).toBe("lamp-post");
    expect(urls.some((u) => u.includes("/database/query"))).toBe(false);
  });
});

describe("the OneSignal connector", () => {
  it("reads the app's counts with its App API key and keeps none of its credentials", async () => {
    const auth: Array<string | null> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL, init?: RequestInit) => {
        auth.push(new Headers(init?.headers).get("authorization"));
        return json({ id: "app", name: "Flowsophy", players: 1480, messageable_players: 1210, apns_p8: "secret-p8" });
      }),
    );
    const facts = await CONNECTOR_BY_SLUG.get("onesignal")!.probe("os_v2_app_x", { appId: "5eb5a37e-b458-11e3-ac11-000c2940e62c" });
    expect(facts.map((f) => [f.metric, f.numeric])).toEqual([
      ["subscribed", 1210],
      ["subscriptions", 1480],
    ]);
    expect(JSON.stringify(facts)).not.toContain("secret-p8");
    expect(auth).toEqual(["Key os_v2_app_x"]);
  });
});

describe("the Clerk connector", () => {
  it("refuses a publishable key, checks the key belongs to the declared instance, and says what Clerk's API does not report", async () => {
    const clerk = CONNECTOR_BY_SLUG.get("clerk")!;
    await expect(clerk.probe("pk_test_abcdefgh", {})).rejects.toThrow(/publishable key/);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.endsWith("/v1/instance")) return json({ object: "instance", id: "ins_2", environment_type: "production", allowed_origins: [], max_allowed_users: null });
        if (url.endsWith("/v1/users/count")) return json({ object: "total_count", total_count: 1234 });
        if (url.includes("/v1/organizations")) return json({ data: [], total_count: 3 });
        return json({}, 404);
      }),
    );
    await expect(clerk.probe("sk_live_abcdefgh", { instanceId: "ins_1" })).rejects.toThrow(/belongs to the Clerk instance ins_2/);
    const facts = await clerk.probe("sk_live_abcdefgh", { instanceId: "ins_2" });
    expect(facts.find((f) => f.metric === "users_total")?.numeric).toBe(1234);
    expect(facts.find((f) => f.metric === "organizations_total")?.numeric).toBe(3);
    expect(facts.find((f) => f.metric === "environment")?.value).toBe("Production");
    expect(facts.find((f) => f.metric === "not_reported")?.value).toMatch(/monthly retained users/);
  });
});

describe("the RevenueCat connector", () => {
  it("reads the project, its apps and the overview metrics in dollars, under its own names where the cockpit has one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.endsWith("/v2/projects?limit=100")) return json({ object: "list", items: [{ object: "project", id: "proj1", name: "Lamp Post" }] });
        if (url.includes("/v2/projects/proj1/apps")) return json({ object: "list", items: [{ id: "app1", name: "Lamp Post iOS", type: "app_store" }, { id: "app2", name: "Lamp Post Android", type: "play_store" }] });
        if (url.includes("/metrics/overview")) {
          expect(url).toContain("currency=USD");
          return json({
            object: "overview_metrics",
            currency: "USD",
            metrics: [
              { object: "overview_metric", id: "active_subscriptions", name: "Active Subscriptions", unit: "#", period: "P0D", value: 42 },
              { object: "overview_metric", id: "revenue", name: "Revenue", unit: "$", period: "P28D", value: 1234.5 },
              { object: "overview_metric", id: "mrr", name: "MRR", unit: "$", period: "P0D", value: 900 },
              { object: "overview_metric", id: "installs", name: "Installs", unit: "#", period: "P28D", value: 77 },
            ],
          });
        }
        return json({}, 404);
      }),
    );
    const rc = CONNECTOR_BY_SLUG.get("revenuecat")!;
    const facts = await rc.probe("sk_v2_abcdefgh", { projectId: "proj1" });
    expect(facts.find((f) => f.metric === "project")?.value).toBe("Lamp Post");
    expect(facts.find((f) => f.metric === "apps")?.numeric).toBe(2);
    expect(facts.find((f) => f.metric === "apps")?.value).toBe("Lamp Post iOS (App Store), Lamp Post Android (Play Store)");
    expect(facts.find((f) => f.metric === "active_subscriptions")?.numeric).toBe(42);
    const mtr = facts.find((f) => f.metric === "mtr_usd_month")!;
    expect(mtr.kind).toBe("usage");
    expect(mtr.numeric).toBe(1234.5);
    expect(mtr.unit).toBe("USD");
    expect(facts.find((f) => f.metric === "mrr")?.value).toBe("900.00 USD");
    expect(facts.find((f) => f.metric === "rc_installs")?.label).toBe("Installs, last 28 days");
    await expect(rc.probe("sk_v2_abcdefgh", { projectId: "proj9" })).rejects.toThrow(/no RevenueCat project with id proj9/);
  });

  it("names the permission a refused part needs instead of failing the key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.endsWith("/v2/projects?limit=100")) return json({ items: [{ id: "proj1", name: "Lamp Post" }] });
        return json({ message: "forbidden" }, 403);
      }),
    );
    const facts = await CONNECTOR_BY_SLUG.get("revenuecat")!.probe("sk_v2_abcdefgh", { projectId: "proj1" });
    expect(facts.find((f) => f.metric === "apps_access")?.value).toMatch(/project_configuration:apps:read/);
    expect(facts.find((f) => f.metric === "metrics_access")?.value).toMatch(/charts_metrics:overview:read/);
  });
});

describe("the GitHub connector", () => {
  it("reads the repository, the newest run on the default branch, the security alerts by severity and the month's usage, and says what each refused part needs", async () => {
    const headers: Array<Record<string, string>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        headers.push((init?.headers ?? {}) as Record<string, string>);
        if (url === "https://api.github.com/repos/acme/app") return json({ private: true, default_branch: "main", pushed_at: "2026-10-26T10:00:00Z", open_issues_count: 4, html_url: "https://github.com/acme/app" });
        if (url.includes("/actions/runs")) {
          expect(url).toContain("branch=main");
          return json({
            total_count: 2,
            workflow_runs: [
              { id: 1, name: "Deploy", status: "completed", conclusion: "failure", html_url: "https://github.com/acme/app/actions/runs/1", updated_at: "2026-10-27T09:00:00Z", head_branch: "main" },
              { id: 2, name: "Deploy", status: "completed", conclusion: "success", html_url: "https://github.com/acme/app/actions/runs/2", updated_at: "2026-10-26T09:00:00Z", head_branch: "main" },
            ],
          });
        }
        if (url.includes("/dependabot/alerts")) return json([{ number: 1, security_vulnerability: { severity: "high" }, dependency: { package: { name: "lodash" } } }, { number: 2, security_advisory: { severity: "medium" }, dependency: { package: { name: "minimist" } } }]);
        if (url.includes("/secret-scanning/alerts")) return json({ message: "Secret scanning is disabled on this repository." }, 404);
        if (url.includes("/code-scanning/alerts")) return json({ message: "Advanced Security must be enabled for this repository to use code scanning." }, 403);
        if (url === "https://api.github.com/user") return json({ login: "acme-owner", plan: { name: "free" } });
        if (url.includes("/settings/billing/usage")) {
          return json({
            usageItems: [
              { date: "2026-10-05", product: "Actions", sku: "Actions Linux", quantity: 320, unitType: "Minutes", pricePerUnit: 0.008, grossAmount: 2.56, discountAmount: 2.56, netAmount: 0, repositoryName: "acme/app" },
              { date: "2026-10-05", product: "Copilot", sku: "Copilot Pro", quantity: 1, unitType: "UserMonths", pricePerUnit: 10, grossAmount: 10, discountAmount: 0, netAmount: 10 },
            ],
          });
        }
        return json({}, 404);
      }),
    );
    const facts = await CONNECTOR_BY_SLUG.get("github")!.probe("github_pat_abcdefgh", { repo: "acme/app" });
    expect(headers[0]?.["authorization"]).toBe("Bearer github_pat_abcdefgh");
    expect(facts.find((f) => f.metric === "repository")?.value).toBe("Private, default branch main, last push 26 October 2026");
    expect(facts.find((f) => f.metric === "open_issues")?.numeric).toBe(4);
    expect(facts.find((f) => f.metric === "ci_latest")?.value).toBe("Deploy on main failed on 27 October 2026");
    const failed = facts.find((f) => f.metric === "ci_failed")!;
    expect(failed.numeric).toBe(1);
    expect(failed.value).toBe("The newest run of Deploy on main of acme/app failed on 27 October 2026");
    expect(failed.evidence?.url).toBe("https://github.com/acme/app/actions/runs/1");
    expect(facts.find((f) => f.metric === "dependabot_open")?.value).toBe("2 open: 1 high, 1 medium");
    expect(facts.find((f) => f.metric === "dependabot_serious")).toMatchObject({ numeric: 1, value: "1 open: lodash" });
    expect(facts.find((f) => f.metric === "secret_scanning_access")?.value).toMatch(/off for this repository/);
    expect(facts.find((f) => f.metric === "code_scanning_access")?.value).toMatch(/Advanced Security/);
    expect(facts.find((f) => f.metric === "plan")?.value).toBe("Free");
    expect(facts.find((f) => f.metric === "spend_month")?.numeric).toBe(10);
    expect(facts.find((f) => f.metric === "actions_minutes_month")?.numeric).toBe(320);
  });

  it("explains a repository the token cannot see", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ message: "Not Found" }, 404)));
    await expect(CONNECTOR_BY_SLUG.get("github")!.probe("github_pat_abcdefgh", { repo: "acme/other" })).rejects.toThrow(/sees only the repositories it was made for/);
    await expect(CONNECTOR_BY_SLUG.get("github")!.probe("github_pat_abcdefgh", { repo: "acme" })).rejects.toThrow(/owner\/name/);
  });
});

describe("the App Store Connect connector", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;

  it("signs a token the way Apple asks: ES256, the key id in the header, the issuer or the subject user, a short life", () => {
    const token = appleToken({ keyId: "2X9R4HXF34", issuerId: "57246542-96fe-1a63-e053-0824d011072a", privateKey: pem.replace(/\n/g, ""), now: Date.UTC(2026, 9, 27, 12) });
    const [h, p, s] = token.split(".");
    expect(JSON.parse(Buffer.from(h!, "base64url").toString())).toEqual({ alg: "ES256", kid: "2X9R4HXF34", typ: "JWT" });
    const payload = JSON.parse(Buffer.from(p!, "base64url").toString()) as { iss: string; iat: number; exp: number; aud: string; sub?: string };
    expect(payload).toMatchObject({ iss: "57246542-96fe-1a63-e053-0824d011072a", aud: "appstoreconnect-v1", iat: Date.UTC(2026, 9, 27, 12) / 1000 });
    expect(payload.exp - payload.iat).toBe(15 * 60);
    expect(payload.sub).toBeUndefined();
    expect(verify("sha256", Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(s!, "base64url"))).toBe(true);
    const individual = JSON.parse(Buffer.from(appleToken({ keyId: "K", issuerId: null, privateKey: pem }).split(".")[1]!, "base64url").toString()) as { iss?: string; sub?: string };
    expect(individual).toMatchObject({ sub: "user" });
    expect(individual.iss).toBeUndefined();
    expect(() => appleToken({ keyId: "K", issuerId: null, privateKey: "not a key" })).toThrow(/\.p8/);
  });

  it("reads the app, the live and in-progress versions, a rejected version and the newest build, and checks the bundle id", async () => {
    let bearer = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        bearer = (init?.headers as Record<string, string>)["authorization"] ?? "";
        if (url.includes("/v1/apps/6745532104?")) return json({ data: { id: "6745532104", attributes: { name: "Lamp Post", bundleId: "com.example.lamppost", sku: "LP1" } } });
        if (url.includes("/appStoreVersions")) {
          return json({
            data: [
              { attributes: { platform: "IOS", versionString: "1.4.2", appVersionState: "READY_FOR_DISTRIBUTION", createdDate: "2026-09-01T10:00:00Z" } },
              { attributes: { platform: "IOS", versionString: "1.5.0", appVersionState: "METADATA_REJECTED", createdDate: "2026-10-20T10:00:00Z" } },
            ],
          });
        }
        if (url.includes("/builds")) return json({ data: [{ attributes: { version: "57", uploadedDate: "2026-10-19T10:00:00Z", processingState: "VALID", expired: false } }] });
        return json({}, 404);
      }),
    );
    const asc = CONNECTOR_BY_SLUG.get("apple")!;
    const facts = await asc.probe(pem, { appId: "6745532104", keyId: "2X9R4HXF34", issuerId: "57246542-96fe-1a63-e053-0824d011072a" });
    expect(bearer.startsWith("Bearer ey")).toBe(true);
    expect(facts.find((f) => f.metric === "app")?.value).toBe("Lamp Post (com.example.lamppost)");
    expect(facts.find((f) => f.metric === "live_version")?.value).toBe("1.4.2 on iOS");
    expect(facts.find((f) => f.metric === "version_in_progress")?.value).toBe("1.5.0 on iOS, metadata rejected");
    expect(facts.find((f) => f.metric === "version_rejected")).toMatchObject({ numeric: 1, value: "1.5.0 on iOS, metadata rejected" });
    expect(facts.find((f) => f.metric === "latest_build")?.value).toBe("Build 57, uploaded 19 October 2026 (processed)");
    expect(facts.find((f) => f.metric === "build_failed")).toBeUndefined();
    await expect(asc.probe(pem, { appId: "6745532104", keyId: "2X9R4HXF34", bundleId: "com.example.other" })).rejects.toThrow(/bundle id is com.example.lamppost/);
    await expect(asc.probe(pem, { appId: "6745532104" })).rejects.toThrow(/Key ID/);
  });
});
