import { afterEach, describe, expect, it, vi } from "vitest";
import type { MapMigrations } from "@birdsi/shared";
import { readSupabaseProject } from "./supabase";

const migrations: MapMigrations = {
  style: "versioned",
  dir: "app",
  files: [
    { name: "supabase-schema.sql", path: "app/supabase-schema.sql" },
    { name: "supabase-v73.sql", path: "app/supabase-v73.sql" },
  ],
  verify: {
    path: "app/supabase-verify.sql",
    markers: [
      { migration: "base schema", kind: "table", name: "users", col: null },
      { migration: "v73 cron runs", kind: "table", name: "cron_runs", col: null },
    ],
  },
  record: null,
};

function supabaseApi(status = "ACTIVE_HEALTHY", overrides: Record<string, () => Response> = {}) {
  const queries: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      for (const [part, respond] of Object.entries(overrides)) if (url.includes(part)) return respond();
      if (url.endsWith("/v1/projects/abcdefghijklmnopqrst")) return Response.json({ id: "abcdefghijklmnopqrst", ref: "abcdefghijklmnopqrst", name: "flowsophy", region: "us-east-1", status, created_at: "2025-06-01T00:00:00Z", database: { version: "17.4.1", host: "db.x" } });
      if (url.includes("/database/query/read-only")) {
        const query = (JSON.parse(String(init?.body)) as { query: string }).query;
        queries.push(query);
        if (query.includes("pg_database_size")) return Response.json([{ bytes: 335_544_320 }]);
        if (query.includes("with markers")) return Response.json([{ i: 0, ok: true }, { i: 1, ok: false }]);
      }
      if (url.endsWith("/advisors/security")) return Response.json({ lints: [{ name: "rls_disabled_in_public", title: "RLS Disabled in Public", level: "ERROR", facing: "EXTERNAL", categories: ["SECURITY"], description: "x", detail: "Table public.cron_runs is public, but RLS has not been enabled.", remediation: "https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public", cache_key: "k" }] });
      if (url.endsWith("/advisors/performance")) return Response.json({ lints: [{ name: "unindexed_foreign_keys", title: "Unindexed foreign keys", level: "INFO", detail: "Table public.likes has a foreign key without an index.", remediation: null }, { name: "auth_rls_initplan", title: "Auth RLS Initialization Plan", level: "WARN", detail: "Policy x re-evaluates auth.uid() for each row." }] });
      return new Response("{}", { status: 404 });
    }),
  );
  return queries;
}

afterEach(() => vi.unstubAllGlobals());

describe("reading a Supabase project", () => {
  it("reads the status, the size, the advisors and the migrations owed, with catalog queries only", async () => {
    const queries = supabaseApi();
    const read = await readSupabaseProject("sbp_token", "abcdefghijklmnopqrst", migrations, { now: new Date() });
    expect(read.project).toMatchObject({ ok: true, value: { status: "ACTIVE_HEALTHY", paused: false, postgresVersion: "17.4.1" }, source: { page: "https://supabase.com/dashboard/project/abcdefghijklmnopqrst" } });
    expect(read.size).toMatchObject({ ok: true, value: { bytes: 335_544_320 } });
    expect(read.security).toMatchObject({ ok: true, value: [{ name: "rls_disabled_in_public", level: "ERROR" }] });
    expect(read.performance.ok && read.performance.value.map((l) => l.level)).toEqual(["WARN", "INFO"]);
    expect(read.migrations).toMatchObject({ ok: true, value: { method: "markers", checked: 2, owed: [{ migration: "supabase-v73.sql", file: "app/supabase-v73.sql", missing: ["the table cron_runs"] }] } });
    // Never a row of the app's tables: every query reads the catalog or the size function.
    for (const q of queries) expect(q).not.toMatch(/\bfrom\s+(public\.|auth\.|storage\.objects)/);
  });

  it("does not query a paused project, and says why on each part", async () => {
    const queries = supabaseApi("INACTIVE");
    const read = await readSupabaseProject("sbp_token", "abcdefghijklmnopqrst", migrations, { now: new Date() });
    expect(read.project).toMatchObject({ ok: true, value: { paused: true } });
    for (const part of [read.size, read.security, read.performance, read.migrations]) expect(part).toMatchObject({ ok: false, reason: expect.stringContaining("paused") });
    expect(queries).toEqual([]);
  });

  it("says when the key is refused", async () => {
    supabaseApi("ACTIVE_HEALTHY", { "/v1/projects/abcdefghijklmnopqrst": () => new Response("{}", { status: 401 }) });
    const read = await readSupabaseProject("sbp_token", "abcdefghijklmnopqrst", migrations, { now: new Date() });
    expect(read.project).toMatchObject({ ok: false, reason: expect.stringContaining("refused the key") });
    expect(read.migrations).toMatchObject({ ok: false });
  });

  it("says when the code has no markers to check", async () => {
    supabaseApi();
    const read = await readSupabaseProject("sbp_token", "abcdefghijklmnopqrst", { ...migrations, verify: null }, { now: new Date() });
    expect(read.migrations).toMatchObject({ ok: true, value: { method: "none", owed: [] } });
  });
});
