import { describe, expect, it } from "vitest";
import { runPool } from "./pool";

describe("runPool", () => {
  it("processes every item with at most the given number in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    const seen: number[] = [];
    await runPool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5 + (n % 3) * 3));
      seen.push(n);
      inFlight -= 1;
    });
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(peak).toBe(3);
  });

  it("handles an empty list and a width larger than the list", async () => {
    let calls = 0;
    await runPool([], 4, async () => {
      calls += 1;
    });
    await runPool(["a"], 8, async () => {
      calls += 1;
    });
    expect(calls).toBe(1);
  });
});
