import { describe, expect, it } from "vitest";
import type { CheckContext } from "./types";
import { redact, secretsCheck } from "./secrets";

function contextFor(files: Record<string, string>): CheckContext {
  const events: unknown[] = [];
  return {
    inventory: { root: "/x", files: Object.keys(files).map((path) => ({ path, bytes: files[path]!.length, language: "TypeScript" })), skipped: 0, folders: [], languages: [] },
    read: async (path: string) => files[path] ?? "",
    emit: async (e: unknown) => void events.push(e),
    note: async () => {},
    signal: new AbortController().signal,
    findingsSoFar: [],
    rawDependencies: [],
    dependencies: [],
    filesToRead: [],
  } as unknown as CheckContext;
}

describe("secretsCheck", () => {
  it("finds an AWS key and reports it as proven and critical", async () => {
    const findings = await secretsCheck.run(contextFor({ "lib/s3.ts": 'const key = "AKIAJ7Q3T5R2M9X1V4KB";' }));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ confidence: "proven", severity: "critical", checkId: "secrets", location: { path: "lib/s3.ts", lineStart: 1 } });
    expect(findings[0]!.evidence.excerpt).not.toContain("AKIAJ7Q3T5R2M9X1V4KB");
  });

  it("skips placeholders and env reads", async () => {
    const findings = await secretsCheck.run(
      contextFor({
        "config.ts": 'const key = process.env.STRIPE_KEY; // sk_live_XXXXXXXXXXXXXXXXXXXXXXXX',
        "README.md": "Set STRIPE_KEY=sk_live_your_key_here_0000000000",
        "docs.md": 'Use the AWS documentation key AKIAIOSFODNN7EXAMPLE to try it',
      }),
    );
    expect(findings).toHaveLength(0);
  });

  it("treats a committed env file as steps, and code as fixable", async () => {
    const findings = await secretsCheck.run(
      contextFor({
        ".env.production": "DATABASE_URL=postgres://admin:hunter2@db.bakery-prod.supabase.co/app",
        "db.ts": 'const url = "postgres://admin:hunter2@db.bakery-prod.supabase.co/app";',
      }),
    );
    const env = findings.find((f) => f.location?.path === ".env.production");
    const code = findings.find((f) => f.location?.path === "db.ts");
    expect(env?.actionKind).toBe("steps");
    expect(code?.actionKind).toBe("fix");
    expect(code?.fixPlan?.paths).toContain("db.ts");
  });

  it("reports one finding per rule per file", async () => {
    const findings = await secretsCheck.run(contextFor({ "a.ts": 'a("AKIAJ7Q3T5R2M9X1V4KB"); b("AKIAI44QH8DHBQ2M9X1V");' }));
    expect(findings).toHaveLength(1);
  });
});

describe("redact", () => {
  it("keeps only the edges of the secret", () => {
    const line = redact('key = "AKIAIOSFODNN7EXAMPLE"', "AKIAIOSFODNN7EXAMPLE");
    expect(line).toContain("AKIAIO");
    expect(line).toContain("PLE");
    expect(line).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });
});
