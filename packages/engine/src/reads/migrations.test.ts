import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import type { MapMigrations, MigrationMarker } from "@birdsi/shared";
import { fileForLabel, markerQuery, owedFromHistory, owedFromMarkers } from "./migrations";

const files: MapMigrations["files"] = [
  { name: "supabase-schema.sql", path: "app/supabase-schema.sql" },
  { name: "supabase-v72.sql", path: "app/supabase-v72.sql" },
  { name: "supabase-v73.sql", path: "app/supabase-v73.sql" },
];

const markers: MigrationMarker[] = [
  { migration: "base schema", kind: "table", name: "users", col: null },
  { migration: "v72 guide in spend", kind: "comment", name: "sum_ai_spend", col: "v72" },
  { migration: "v73 cron runs", kind: "table", name: "cron_runs", col: null },
  { migration: "v73 cron runs: last run", kind: "column", name: "cron_runs", col: "finished_at" },
  { migration: "v74 the owner's flag", kind: "no_column", name: "users", col: "legacy_flag" },
  { migration: "0013 uploads: photos", kind: "bucket_type", name: "photos", col: "image/jpeg" },
  { migration: "a custom check", kind: "row_count", name: "users", col: null },
];

describe("the marker query", () => {
  it("reads the catalog only and says which markers the database has", async () => {
    const db = new PGlite();
    await db.exec(`
      create schema storage;
      create table storage.buckets (id text primary key, allowed_mime_types text[], file_size_limit bigint);
      insert into storage.buckets values ('photos', array['image/jpeg'], 5242880);
      create table public.users (id int, legacy_flag boolean);
      create function public.sum_ai_spend() returns int language sql as 'select 1';
      comment on function public.sum_ai_spend() is 'v72: the guide counts';
    `);
    const query = markerQuery(markers)!;
    // The custom kind is not checkable, and nothing but the catalog and bucket settings is read.
    expect(query.indexes).toEqual([0, 1, 2, 3, 4, 5]);
    const relations = [...query.sql.matchAll(/\b(?:from|join)\s+([a-z_.]+)/g)].map((m) => m[1]);
    expect(new Set(relations)).toEqual(new Set(["markers", "information_schema.tables", "information_schema.columns", "pg_catalog.pg_proc", "pg_catalog.pg_description", "storage.buckets"]));
    const rows = (await db.query<{ i: number; ok: boolean | null }>(query.sql)).rows;
    const results = new Map(rows.map((r) => [r.i, r.ok]));
    expect([...results.entries()]).toEqual([
      [0, true],
      [1, true],
      [2, false],
      [3, false],
      [4, false],
      [5, true],
    ]);

    const { owed, unknown } = owedFromMarkers({ style: "versioned", dir: "app", files, verify: { path: "app/supabase-verify.sql", markers }, record: null }, results);
    expect(owed).toEqual([
      { migration: "supabase-v73.sql", file: "app/supabase-v73.sql", missing: ["the table cron_runs", "the column cron_runs.finished_at"] },
      { migration: "v74 the owner's flag", file: null, missing: ["the column users.legacy_flag removed"] },
    ]);
    expect(unknown).toEqual(["a custom check: row_count users"]);
  });

  it("quotes every name, so a marker cannot change the query", () => {
    const query = markerQuery([{ migration: "x", kind: "table", name: "a'); drop table users; --", col: null }])!;
    expect(query.sql).toContain("'a''); drop table users; --'");
  });

  it("leaves out markers with control characters or no column where one is needed", () => {
    expect(markerQuery([{ migration: "x", kind: "table", name: "bad\nname", col: null }])).toBeNull();
    expect(markerQuery([{ migration: "x", kind: "column", name: "users", col: null }])).toBeNull();
  });
});

describe("the file a marker names", () => {
  it("matches versions, numbers, timestamps and the base schema", () => {
    expect(fileForLabel("v73 cron runs", files)?.name).toBe("supabase-v73.sql");
    expect(fileForLabel("base schema", files)?.name).toBe("supabase-schema.sql");
    expect(fileForLabel("v7 old", files)).toBeNull();
    const numbered = [{ name: "0013_uploads.sql", path: "supabase/migrations/0013_uploads.sql" }];
    expect(fileForLabel("0013 uploads: photos", numbered)?.path).toBe("supabase/migrations/0013_uploads.sql");
    const cli = [{ name: "20261018000100_apps_projects.sql", path: "supabase/migrations/20261018000100_apps_projects.sql" }];
    expect(fileForLabel("20261018000100 apps", cli)?.name).toBe("20261018000100_apps_projects.sql");
  });
});

describe("migrations owed by the CLI history", () => {
  it("lists the files whose version the project has not applied", () => {
    const cli: MapMigrations = {
      style: "supabase-cli",
      dir: "supabase/migrations",
      files: [
        { name: "20261006000000_queue.sql", path: "supabase/migrations/20261006000000_queue.sql" },
        { name: "20261018000100_apps.sql", path: "supabase/migrations/20261018000100_apps.sql" },
      ],
      verify: null,
      record: null,
    };
    expect(owedFromHistory(cli, new Set(["20261006000000"]))).toEqual([{ migration: "20261018000100_apps.sql", file: "supabase/migrations/20261018000100_apps.sql", missing: ["version 20261018000100 in the project's migration history"] }]);
  });
});
