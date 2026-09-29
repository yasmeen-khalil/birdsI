import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScanEvent } from "@birdsi/shared";

/**
 * Runs the whole pipeline over the bundled sample repository with the model
 * and the network mocked, so every deterministic check and the event log
 * are exercised together.
 */
vi.mock("openai", () => {
  class FakeOpenAI {
    chat = {
      completions: {
        create: async (req: { messages: Array<{ role: string; content: string }> }) => {
          const system = req.messages[0]?.content ?? "";
          const user = req.messages[1]?.content ?? "";
          let content = '{"findings":[]}';
          if (system.includes("one file of an application") && user.includes("File: app/api/staff/orders/route.ts")) {
            content = JSON.stringify({
              findings: [
                {
                  title: "Anyone can read every customer order",
                  explanation: "The staff orders route has no sign-in check, so any visitor can call it.",
                  whyItMatters: "Customer emails and phone numbers are exposed.",
                  severity: "critical",
                  category: "security",
                  path: "app/api/staff/orders/route.ts",
                  lineStart: 5,
                  lineEnd: 8,
                  excerpt: "export async function GET() {",
                  certainty: 0.95,
                  actionKind: "fix",
                  steps: [],
                  fixSummary: "Require a staff session before returning orders.",
                  fixPaths: ["app/api/staff/orders/route.ts"],
                  docUrl: null,
                  docQuote: null,
                },
              ],
            });
          }
          if (system.includes("pre-launch verdict")) {
            content = JSON.stringify({
              headline: "Not ready to launch yet.",
              areas: ["auth", "secrets", "data", "dependencies", "errors", "config", "legal", "tests"].map((area) => ({ area, verdict: area === "secrets" ? "blocker" : "pass", note: "ok" })),
              blockers: ["Rotate the committed database password"],
              fixBeforeLaunch: [],
              canWait: [],
            });
          }
          return { choices: [{ message: { content } }], usage: { prompt_tokens: 100, completion_tokens: 20 } };
        },
      },
    };
    embeddings = { create: async () => ({ data: [], usage: { prompt_tokens: 0 } }) };
  }
  return { default: FakeOpenAI };
});

const { loadEngineConfig } = await import("../config");
const { runScan } = await import("./runner");
const { snapshotFromDirectory } = await import("../source/tarball");

const sample = resolve(import.meta.dirname, "../../../../samples/corner-bakery");

beforeEach(() => {
  process.env["NEBIUS_API_KEY"] = "test-key";
  delete process.env["TAVILY_API_KEY"];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("api.osv.dev/v1/querybatch")) {
        // The first package has a known vulnerability; the rest are clean.
        return new Response(JSON.stringify({ results: Array.from({ length: 12 }, (_, i) => (i === 0 ? { vulns: [{ id: "GHSA-lodash", modified: "2026" }] } : {})) }), { status: 200 });
      }
      if (url.includes("api.osv.dev/v1/vulns/")) {
        return new Response(JSON.stringify({ id: "GHSA-lodash", summary: "Prototype pollution", database_specific: { severity: "HIGH" }, affected: [{ ranges: [{ type: "ECOSYSTEM", events: [{ introduced: "0" }, { fixed: "4.17.21" }] }] }] }), { status: 200 });
      }
      if (url.includes("api.deps.dev")) {
        return new Response(JSON.stringify({ versions: [{ versionKey: { version: "99.0.0" }, isDefault: true }] }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runScan over the sample repository", () => {
  it("finds the planted problems and writes a coherent event log", async () => {
    const events: ScanEvent[] = [];
    const result = await runScan(loadEngineConfig(), {
      kind: "light",
      snapshot: snapshotFromDirectory(sample, { fullName: "birdsi-demo/corner-bakery", branch: "main" }),
      onEvent: async (e) => void events.push(e),
    });

    const titles = result.findings.map((f) => `${f.checkId}: ${f.title}`);
    // Secrets: the committed production env file with a database password.
    expect(titles.some((t) => /Database connection string.*\.env\.production/.test(t)), titles.join("\n")).toBe(true);
    // Config: the env file is tracked at all.
    expect(titles).toContain("config: .env.production is part of the repository");
    // Vulnerabilities from OSV.
    expect(result.findings.some((f) => f.checkId === "vulnerabilities" && f.confidence === "proven")).toBe(true);
    // Freshness: everything is far behind the mocked latest 99.0.0.
    expect(result.findings.some((f) => f.checkId === "freshness")).toBe(true);
    // The model review finding on the staff route.
    const review = result.findings.find((f) => f.checkId === "review");
    expect(review).toMatchObject({ confidence: "judgment", severity: "critical", actionKind: "fix", location: { path: "app/api/staff/orders/route.ts", lineStart: 5 } });

    // Ranking: critical first, proven before judgment at equal severity.
    expect(result.findings[0]!.severity).toBe("critical");
    expect(result.summary.bySeverity.critical).toBeGreaterThanOrEqual(2);
    expect(result.summary.fixable + result.summary.needsYou).toBe(result.findings.length);

    // Event log shape.
    expect(events[0]).toMatchObject({ type: "scan_started", kind: "light" });
    expect(events.at(-1)).toMatchObject({ type: "scan_done", findings: result.findings.length });
    const inventory = events.find((e) => e.type === "inventory");
    expect(inventory && inventory.type === "inventory" && inventory.filesSeen).toBeGreaterThan(10);
    const steps = events.filter((e) => e.type === "step_started").map((e) => (e as { step: string }).step);
    expect(steps).toEqual(expect.arrayContaining(["inventory", "secrets", "vulnerabilities", "dependencies", "review", "rank"]));
    expect(events.some((e) => e.type === "note" && e.text.includes("current documentation"))).toBe(true);
    expect(result.stats.inputTokens).toBeGreaterThan(0);
    expect(result.audit).toBeNull();
  });

  it("produces an audit report in the audit tier", async () => {
    const result = await runScan(loadEngineConfig(), {
      kind: "audit",
      snapshot: snapshotFromDirectory(sample),
      onEvent: async () => {},
    });
    expect(result.audit?.verdict).toBe("not_ready");
    expect(result.audit?.areas).toHaveLength(8);
    expect(result.audit?.areas.find((a) => a.area === "secrets")?.verdict).toBe("blocker");
  });

  it("stops cleanly when aborted", async () => {
    const controller = new AbortController();
    const result = await runScan(loadEngineConfig(), {
      kind: "light",
      snapshot: snapshotFromDirectory(sample),
      signal: controller.signal,
      onEvent: async (e) => {
        if (e.type === "step_done" && e.step === "secrets") controller.abort();
      },
    });
    expect(result.audit).toBeNull();
    expect(result.findings.length).toBeGreaterThan(0);
  });
});
