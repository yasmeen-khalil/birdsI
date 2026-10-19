import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { describe, expect, it } from "vitest";

/**
 * Applies every migration in filename order to a real Postgres (PGlite), the
 * way the owner pastes them into the Supabase SQL editor, then runs
 * supabase/verify.sql. Supabase provides some things a bare Postgres does not:
 * the API roles and the storage schema are created first, and the pgvector
 * type of the chat index retired in v3 is read as text (with function bodies
 * unchecked), the only change made to any file.
 */
const root = join(import.meta.dirname, "..", "..", "..", "supabase");
const files = readdirSync(join(root, "migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort();

const SUPABASE_STAND_IN = `
  create role service_role; create role anon; create role authenticated;
  create schema storage;
  create table storage.buckets (id text primary key, name text not null, public boolean, file_size_limit bigint);
  set check_function_bodies = off;
`;

function sql(file: string): string {
  const text = readFileSync(join(root, "migrations", file), "utf8");
  return text
    .replace(/create extension if not exists vector;/g, "")
    .replace(/vector\(4096\)/g, "text")
    .replace(/\(uuid, vector, integer\)/g, "(uuid, text, integer)");
}

async function database(upTo?: string): Promise<PGlite> {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(SUPABASE_STAND_IN);
  for (const file of files) {
    if (upTo && file > upTo) break;
    await db.exec(sql(file));
  }
  return db;
}

async function verify(db: PGlite): Promise<Array<{ migration: string; marker: string; status: string }>> {
  const results = await db.exec(readFileSync(join(root, "verify.sql"), "utf8"));
  return results.at(-1)!.rows as Array<{ migration: string; marker: string; status: string }>;
}

describe("the migrations", () => {
  it("run in order on a fresh database, and verify.sql then says OK on every row", async () => {
    const db = await database();
    const rows = await verify(db);
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.filter((r) => r.status !== "OK"), JSON.stringify(rows.filter((r) => r.status !== "OK"))).toEqual([]);
  }, 60_000);

  it("verify.sql names a migration that has not run", async () => {
    const db = await database("20261006000100_record.sql");
    const missing = (await verify(db)).filter((r) => r.status !== "OK").map((r) => r.migration);
    expect(missing.some((m) => m.startsWith("20261018000000"))).toBe(true);
    expect(missing.some((m) => m.startsWith("20261006"))).toBe(false);
  }, 60_000);

  it("ties the connections of an owner with one app to projects, and keeps an owner's with several apps as they were", async () => {
    const db = await database("20261018000000_v3_retire_audit.sql");
    await db.exec(`
      insert into public.users (id, clerk_user_id) values
        ('00000000-0000-0000-0000-00000000000a', 'user_a'),
        ('00000000-0000-0000-0000-00000000000b', 'user_b');
      insert into public.repos (id, full_name, owner_user_id, source) values
        ('00000000-0000-0000-0000-0000000000a1', 'owner/flowsophy', '00000000-0000-0000-0000-00000000000a', 'local'),
        ('00000000-0000-0000-0000-0000000000b1', 'owner/lamp-post', '00000000-0000-0000-0000-00000000000b', 'local'),
        ('00000000-0000-0000-0000-0000000000b2', 'owner/vaultaire', '00000000-0000-0000-0000-00000000000b', 'local');
      insert into public.connections (owner_user_id, vendor_slug, token_ciphertext, settings) values
        ('00000000-0000-0000-0000-00000000000a', 'vercel', 'v1.x.y.z', '{"teamId": "team_123"}'),
        ('00000000-0000-0000-0000-00000000000a', 'supabase', 'v1.x.y.z', '{"projectRef": "abcdefghijklmnopqrst"}'),
        ('00000000-0000-0000-0000-00000000000a', 'anthropic', 'v1.x.y.z', '{}'),
        ('00000000-0000-0000-0000-00000000000b', 'vercel', 'v1.x.y.z', '{}');
    `);
    const step2 = files.find((f) => f.startsWith("20261018000100"))!;
    await db.exec(sql(step2));

    const apps = (await db.query<{ name: string; owner_user_id: string }>("select name, owner_user_id from public.apps order by name")).rows;
    expect(apps.map((a) => a.name)).toEqual(["flowsophy", "lamp-post", "vaultaire"]);

    const tied = (
      await db.query<{ vendor: string; kind: string; ref: string; tied: boolean }>(
        `select p.vendor, p.kind, p.ref, c.app_project_id = p.id as tied
           from public.connections c join public.app_projects p on p.id = c.app_project_id
          where c.owner_user_id = '00000000-0000-0000-0000-00000000000a' order by p.vendor`,
      )
    ).rows;
    expect(tied).toEqual([
      { vendor: "anthropic", kind: "account", ref: "anthropic", tied: true },
      { vendor: "supabase", kind: "project", ref: "abcdefghijklmnopqrst", tied: true },
      { vendor: "vercel", kind: "team", ref: "team_123", tied: true },
    ]);

    const untied = (await db.query<{ n: number }>("select count(*)::int as n from public.connections where owner_user_id = '00000000-0000-0000-0000-00000000000b' and app_project_id is null")).rows[0]!.n;
    expect(untied).toBe(1);
    const keys = (await db.query<{ n: number }>("select count(*)::int as n from public.connections")).rows[0]!.n;
    expect(keys).toBe(4);

    // Read keys only: a write scope is refused by the database itself.
    await expect(db.exec("update public.connections set scope = 'write'")).rejects.toThrow();

    // Running it again changes nothing.
    await db.exec(sql(step2));
    expect((await db.query<{ n: number }>("select count(*)::int as n from public.apps")).rows[0]!.n).toBe(3);
    expect((await db.query<{ n: number }>("select count(*)::int as n from public.app_projects")).rows[0]!.n).toBe(3);
  }, 60_000);
});
