import { describe, expect, it } from "vitest";
import { commandProgram, diffFindings, isAllowedCommand } from "./ops";

describe("isAllowedCommand", () => {
  it("accepts allowlisted programs with plain arguments", () => {
    expect(isAllowedCommand("stripe projects upgrade vercel pro")).toBe(true);
    expect(isAllowedCommand("npm install next@16.3.8")).toBe(true);
    expect(commandProgram("  vercel env pull")).toBe("vercel");
  });

  it("refuses other programs, shell operators and output redirection", () => {
    expect(isAllowedCommand("curl https://x.y -o ~/.zshrc")).toBe(false);
    expect(isAllowedCommand("rm -rf /")).toBe(false);
    expect(isAllowedCommand("npm install && curl x")).toBe(false);
    expect(isAllowedCommand("git log > out.txt")).toBe(false);
    expect(isAllowedCommand("stripe projects status\nrm x")).toBe(false);
    expect(isAllowedCommand("npm run build --output=../x")).toBe(false);
  });
});

describe("diffFindings", () => {
  const row = (key: string, status = "open", id = key) => ({ id, key, title: key, severity: "medium" as const, confidence: "proven", status, path: "a.ts" });

  it("separates new, resolved, still open and dismissed by key", () => {
    const from = [row("a"), row("b"), row("c", "dismissed")];
    const to = [row("a", "open", "a2"), row("d"), row("e", "dismissed"), row("f", "fixed")];
    const diff = diffFindings(from, to);
    expect(diff.newFindings.map((f) => f.key)).toEqual(["d"]);
    expect(diff.resolved.map((f) => f.key)).toEqual(["b"]);
    expect(diff.stillOpen).toBe(1);
    expect(diff.dismissed).toBe(1);
  });

  it("treats a first scan as all new", () => {
    expect(diffFindings([], [row("a")]).newFindings).toHaveLength(1);
    expect(diffFindings([], [row("a")]).resolved).toHaveLength(0);
  });
});
