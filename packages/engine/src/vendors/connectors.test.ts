import { afterEach, describe, expect, it, vi } from "vitest";
import { CONNECTOR_BY_SLUG } from "./connectors";

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
