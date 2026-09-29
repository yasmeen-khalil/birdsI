import { afterEach, describe, expect, it, vi } from "vitest";
import type { CheckContext } from "./types";
import { compareVersionsDesc, toDependency, vulnerabilitiesCheck } from "./vulnerabilities";

describe("compareVersionsDesc", () => {
  it("sorts newest first", () => {
    expect(["1.2.3", "1.10.0", "1.9.9"].sort(compareVersionsDesc)).toEqual(["1.10.0", "1.9.9", "1.2.3"]);
  });
});

describe("vulnerabilitiesCheck", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("turns OSV matches into proven findings with a fixed version", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/querybatch")) {
          return new Response(JSON.stringify({ results: [{ vulns: [{ id: "GHSA-test", modified: "2026-01-01" }] }, {}] }), { status: 200 });
        }
        return new Response(
          JSON.stringify({
            id: "GHSA-test",
            aliases: ["CVE-2026-0001"],
            summary: "Prototype pollution in lodash",
            database_specific: { severity: "HIGH" },
            affected: [{ package: { name: "lodash", ecosystem: "npm" }, ranges: [{ type: "ECOSYSTEM", events: [{ introduced: "0" }, { fixed: "4.17.21" }] }] }],
          }),
          { status: 200 },
        );
      }),
    );
    const raw = [
      { ecosystem: "npm" as const, name: "lodash", version: "4.17.20", declared: "^4.17.20", manifestPath: "package.json", direct: true },
      { ecosystem: "npm" as const, name: "react", version: "18.2.0", declared: "18.2.0", manifestPath: "package.json", direct: true },
    ];
    const ctx = {
      rawDependencies: raw,
      dependencies: raw.map(toDependency),
      emit: async () => {},
      note: async () => {},
      signal: new AbortController().signal,
    } as unknown as CheckContext;
    const findings = await vulnerabilitiesCheck.run(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ confidence: "proven", severity: "high", actionKind: "fix", category: "dependency" });
    expect(findings[0]!.fixPlan?.summary).toContain("4.17.21");
    expect(findings[0]!.evidence.advisories).toEqual(["GHSA-test"]);
    expect(ctx.dependencies[0]!.vulnerabilities).toHaveLength(1);
    expect(ctx.dependencies[1]!.vulnerabilities).toHaveLength(0);
  });
});
