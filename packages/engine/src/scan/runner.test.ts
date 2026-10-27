import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScanEvent } from "@birdsi/shared";
import { loadEngineConfig } from "../config";
import { snapshotFromDirectory } from "../source/tarball";
import { runScan } from "./runner";

/**
 * Runs the whole map over the fixture app with the network mocked, so every
 * rule-based check, the vendor discovery and the event log are exercised
 * together. No model key is set, so the docs check is skipped and says so.
 */
const fixture = resolve(import.meta.dirname, "../../fixtures/cockpit-app");
let root = "";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "birdsi-runner-"));
  await cp(fixture, root, { recursive: true });
  // A committed production env file, built here so no secret shape is ever committed.
  const url = ["postgres", "://", "admin", ":", "hun", "ter2", "@", "db.cockpit-prod.supabase.co/app"].join("");
  await writeFile(join(root, ".env.production"), `DATABASE_URL=${url}\n`);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

beforeEach(() => {
  delete process.env["ANTHROPIC_API_KEY"];
  delete process.env["TAVILY_API_KEY"];
  delete process.env["NEBIUS_API_KEY"];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("api.osv.dev/v1/querybatch")) {
        // lodash is the first package alphabetically after the scoped ones; give every package an answer and one a vulnerability.
        return new Response(JSON.stringify({ results: Array.from({ length: 12 }, (_, i) => (i === 3 ? { vulns: [{ id: "GHSA-lodash", modified: "2026" }] } : {})) }), { status: 200 });
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

describe("runScan over the fixture app", () => {
  it("finds the services and the planted problems, and writes a coherent event log", async () => {
    const events: ScanEvent[] = [];
    const result = await runScan(loadEngineConfig(), {
      snapshot: snapshotFromDirectory(root, { fullName: "example/cockpit-app", branch: "main" }),
      onEvent: async (e) => void events.push(e),
    });

    const slugs = result.vendors.map((v) => v.slug);
    expect(slugs).toEqual(expect.arrayContaining(["clerk", "onesignal", "resend", "revenuecat", "stripe", "supabase", "vercel"]));

    const titles = result.findings.map((f) => `${f.checkId}: ${f.title}`);
    // Secrets: the committed production env file with a database password.
    expect(titles.some((t) => /Database connection string.*\.env\.production/.test(t)), titles.join("\n")).toBe(true);
    // Config: the env file is tracked at all.
    expect(titles).toContain("config: .env.production is part of the repository");
    // Vulnerabilities from OSV, and freshness against the mocked latest 99.0.0.
    expect(result.findings.some((f) => f.checkId === "vulnerabilities" && f.confidence === "proven")).toBe(true);
    expect(result.findings.some((f) => f.checkId === "freshness")).toBe(true);
    // Nothing a model read: every finding is proven by a rule or a database.
    expect(result.findings.every((f) => f.confidence === "proven")).toBe(true);
    expect(result.summary.fixable + result.summary.needsYou).toBe(result.findings.length);

    // Event log shape.
    expect(events[0]).toMatchObject({ type: "scan_started", kind: "light" });
    expect(events.at(-1)).toMatchObject({ type: "scan_done", findings: result.findings.length });
    const steps = events.filter((e) => e.type === "step_started").map((e) => (e as { step: string }).step);
    expect(steps).toEqual(expect.arrayContaining(["inventory", "vendors", "secrets", "vulnerabilities", "rank"]));
    expect(steps).not.toContain("review");
    expect(steps.indexOf("map")).toBe(steps.indexOf("vendors") + 1);
    expect(events.find((e) => e.type === "service_map")).toMatchObject({ crons: 2, webhooks: 3, storeApps: 1, migrations: 2, roles: ["app", "ops"] });
    // The map names env files and lines, never a value from an env file.
    expect(result.map?.env.map((e) => e.name)).not.toContain("DATABASE_URL");
    expect(JSON.stringify(result.map)).not.toContain("hun" + "ter2");
    expect(events.some((e) => e.type === "note" && e.text.includes("skipped"))).toBe(true);
    expect(result.stats.inputTokens).toBe(0);
  });

  it("stops cleanly when aborted", async () => {
    const controller = new AbortController();
    const result = await runScan(loadEngineConfig(), {
      snapshot: snapshotFromDirectory(root),
      signal: controller.signal,
      onEvent: async (e) => {
        if (e.type === "step_done" && e.step === "secrets") controller.abort();
      },
    });
    expect(result.findings.length).toBeGreaterThan(0);
  });
});
