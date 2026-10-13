import { describe, expect, it } from "vitest";
import { pageAll, PAGE_SIZE } from "./paging";

function fakeTable(count: number) {
  const rows = Array.from({ length: count }, (_, i) => ({ id: i + 1, cost_microdollars: 10 }));
  const calls: Array<[number, number]> = [];
  const fetchPage = async (from: number, to: number) => {
    calls.push([from, to]);
    // Like Supabase, never more than PAGE_SIZE rows per request.
    return { data: rows.slice(from, Math.min(to + 1, from + PAGE_SIZE)), error: null };
  };
  return { fetchPage, calls };
}

describe("pageAll", () => {
  it("reads every row past the 1,000-row page limit", async () => {
    const { fetchPage, calls } = fakeTable(2_500);
    const rows = await pageAll<{ cost_microdollars: number }>(fetchPage, "test");
    expect(rows).toHaveLength(2_500);
    expect(rows.reduce((n, r) => n + r.cost_microdollars, 0)).toBe(25_000);
    expect(calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("asks once more when the last page is exactly full", async () => {
    const { fetchPage, calls } = fakeTable(2_000);
    expect(await pageAll(fetchPage, "test")).toHaveLength(2_000);
    expect(calls).toHaveLength(3);
  });

  it("handles an empty result and passes errors on", async () => {
    const { fetchPage } = fakeTable(0);
    expect(await pageAll(fetchPage, "test")).toEqual([]);
    await expect(pageAll(async () => ({ data: null, error: { message: "boom" } }), "totalSpend")).rejects.toThrow("totalSpend: boom");
  });
});
