import { describe, expect, it } from "vitest";
import { extractJson, ModelClient } from "./client";

describe("extractJson", () => {
  it("parses plain JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("parses fenced JSON and reasoning preambles", () => {
    expect(extractJson('Here you go:\n```json\n{"a": [1,2]}\n```')).toEqual({ a: [1, 2] });
    expect(extractJson('Thinking... the answer is {"ok": true} and that is all.')).toEqual({ ok: true });
  });

  it("throws when there is no object", () => {
    expect(() => extractJson("no json here")).toThrow();
  });
});

describe("ModelClient.estimateTokens", () => {
  it("scales with length", () => {
    expect(ModelClient.estimateTokens("")).toBe(0);
    expect(ModelClient.estimateTokens("a".repeat(360))).toBe(100);
  });
});
