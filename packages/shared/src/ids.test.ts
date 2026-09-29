import { describe, expect, it } from "vitest";
import { findingKey, fnv1a64 } from "./ids";

describe("findingKey", () => {
  it("is stable for the same check, path and subject", () => {
    const a = findingKey({ checkId: "secrets", path: "lib/db.ts", subject: "aws-access-key" });
    const b = findingKey({ checkId: "secrets", path: "lib/db.ts", subject: "AWS-Access-Key " });
    expect(a).toBe(b);
    expect(a.startsWith("secrets:")).toBe(true);
  });

  it("changes when any part changes", () => {
    const base = findingKey({ checkId: "review", path: "a.ts", subject: "x" });
    expect(findingKey({ checkId: "review", path: "b.ts", subject: "x" })).not.toBe(base);
    expect(findingKey({ checkId: "docs", path: "a.ts", subject: "x" })).not.toBe(base);
    expect(findingKey({ checkId: "review", path: null, subject: "x" })).not.toBe(base);
  });

  it("hashes to 16 hex characters", () => {
    expect(fnv1a64("")).toMatch(/^[0-9a-f]{16}$/);
    expect(fnv1a64("hello")).not.toBe(fnv1a64("hellp"));
  });
});
