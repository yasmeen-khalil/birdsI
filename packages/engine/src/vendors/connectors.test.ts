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
