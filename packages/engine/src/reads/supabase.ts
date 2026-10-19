import type { AdvisorLint, MapMigrations, MigrationCheck, SupabaseProjectInfo, SupabaseRead } from "@birdsi/shared";
import { maskSecrets } from "../checks/secrets";
import { callJson, iso, notRead, ReadError, reading, str, type ReadContext } from "./http";
import { markerQuery, owedFromHistory, owedFromMarkers } from "./migrations";

/**
 * A Supabase project in depth, through the Management API with a read-only
 * personal access token: its status (paused or not), its database size, the
 * security and performance advisors, and the migrations its database still
 * owes against the markers in the app's own verify.sql. The SQL birdsI runs
 * reads the catalog only, never a row of the app's tables: the owner's rule
 * is that an app's data is read only through the app's ops API or exports.
 */

const API = "https://api.supabase.com";
const LINTS_KEPT = 50;

/** Supabase's statuses that mean the database cannot answer queries now. */
const NOT_RUNNING = new Set(["INACTIVE", "PAUSING", "PAUSE_FAILED", "RESTORING", "RESTORE_FAILED", "COMING_UP", "GOING_DOWN", "REMOVED", "INIT_FAILED", "UPGRADING", "RESIZING", "RESTARTING"]);
const PAUSED = new Set(["INACTIVE", "PAUSING", "PAUSE_FAILED"]);

function page(ref: string, tail = ""): string {
  return `https://supabase.com/dashboard/project/${encodeURIComponent(ref)}${tail}`;
}

/** Runs one read-only query through the Management API and returns its rows. */
async function readOnlyQuery(token: string, ref: string, query: string, ctx: ReadContext): Promise<Array<Record<string, unknown>>> {
  const res = await callJson<unknown>("Supabase", `${API}/v1/projects/${encodeURIComponent(ref)}/database/query/read-only`, { authorization: `Bearer ${token}` }, ctx, { method: "POST", body: { query } });
  const body = res.body;
  if (Array.isArray(body)) return body as Array<Record<string, unknown>>;
  if (body && typeof body === "object" && Array.isArray((body as { result?: unknown }).result)) return (body as { result: Array<Record<string, unknown>> }).result;
  throw new ReadError("Supabase's answer to the read-only query had no rows.");
}

function lints(body: unknown): AdvisorLint[] {
  const list = body && typeof body === "object" && Array.isArray((body as { lints?: unknown }).lints) ? ((body as { lints: Array<Record<string, unknown>> }).lints) : [];
  const levelOf = (v: unknown): AdvisorLint["level"] => (v === "ERROR" || v === "WARN" ? v : "INFO");
  return list
    .map((l) => ({
      name: String(l["name"] ?? ""),
      title: String(l["title"] ?? l["name"] ?? ""),
      level: levelOf(l["level"]),
      detail: maskSecrets(String(l["detail"] ?? l["description"] ?? "").replace(/\s+/g, " ").trim()).slice(0, 300),
      remediation: str(l["remediation"]),
    }))
    .filter((l) => l.name)
    .sort((a, b) => rank(a.level) - rank(b.level))
    .slice(0, LINTS_KEPT);
}

function rank(level: AdvisorLint["level"]): number {
  return level === "ERROR" ? 0 : level === "WARN" ? 1 : 2;
}

export async function readSupabaseProject(token: string, ref: string, migrations: MapMigrations | null, ctx: ReadContext): Promise<SupabaseRead> {
  const auth = { authorization: `Bearer ${token}` };
  const r = encodeURIComponent(ref);

  const project = await reading<SupabaseProjectInfo>({ api: `${API}/v1/projects/${r}`, page: page(ref) }, ctx, async () => {
    const res = await callJson<Record<string, unknown>>("Supabase", `${API}/v1/projects/${r}`, auth, ctx);
    const b = res.body ?? {};
    const status = String(b["status"] ?? "UNKNOWN").toUpperCase();
    const database = (b["database"] as Record<string, unknown> | undefined) ?? {};
    return { ref: String(b["ref"] ?? b["id"] ?? ref), name: String(b["name"] ?? ref), region: str(b["region"]), status, paused: PAUSED.has(status), createdAt: iso(b["created_at"]), postgresVersion: str(database["version"]) };
  });

  const sizeSource = { api: `${API}/v1/projects/${r}/database/query/read-only`, page: page(ref, "/database/settings") };
  const securitySource = { api: `${API}/v1/projects/${r}/advisors/security`, page: page(ref, "/advisors/security") };
  const performanceSource = { api: `${API}/v1/projects/${r}/advisors/performance`, page: page(ref, "/advisors/performance") };
  const migrationsSource = { api: `${API}/v1/projects/${r}/database/query/read-only`, page: page(ref, "/sql/new") };

  if (!project.ok) {
    const reason = `Not read, because the project could not be read: ${project.reason}`;
    return { vendor: "supabase", project, size: notRead(sizeSource, reason), security: notRead(securitySource, reason), performance: notRead(performanceSource, reason), migrations: notRead(migrationsSource, reason) };
  }
  if (NOT_RUNNING.has(project.value.status)) {
    const reason = project.value.paused ? "Not read: the project is paused, so its database does not answer. Restore it in the Supabase dashboard." : `Not read: the project is ${project.value.status.toLowerCase().replace(/_/g, " ")}, so its database does not answer now. The next read tries again.`;
    return { vendor: "supabase", project, size: notRead(sizeSource, reason), security: notRead(securitySource, reason), performance: notRead(performanceSource, reason), migrations: notRead(migrationsSource, reason) };
  }

  const size = await reading(sizeSource, ctx, async () => {
    const rows = await readOnlyQuery(token, ref, "select pg_catalog.pg_database_size(pg_catalog.current_database())::bigint as bytes", ctx);
    const bytes = Number(rows[0]?.["bytes"]);
    if (!Number.isFinite(bytes)) throw new ReadError("Supabase's answer had no database size.");
    return { bytes };
  });

  const security = await reading(securitySource, ctx, async () => lints((await callJson<unknown>("Supabase", securitySource.api, auth, ctx)).body));
  const performance = await reading(performanceSource, ctx, async () => lints((await callJson<unknown>("Supabase", performanceSource.api, auth, ctx)).body));

  const migrationsRead = await reading<MigrationCheck>(migrationsSource, ctx, async () => checkMigrations(token, ref, migrations, ctx));
  if (migrationsRead.ok && migrationsRead.value.method === "history") migrationsRead.source = { api: `${API}/v1/projects/${r}/database/migrations`, page: page(ref, "/database/migrations") };

  return { vendor: "supabase", project, size, security, performance, migrations: migrationsRead };
}

async function checkMigrations(token: string, ref: string, migrations: MapMigrations | null, ctx: ReadContext): Promise<MigrationCheck> {
  if (!migrations || migrations.files.length === 0) return { method: "none", how: "The app's code holds no migrations, so there is nothing to check.", checked: 0, owed: [], unknown: [] };
  const markers = migrations.verify?.markers ?? [];
  const query = markerQuery(markers);
  if (query) {
    const rows = await readOnlyQuery(token, ref, query.sql, ctx);
    const results = new Map<number, boolean | null>();
    for (const row of rows) {
      const i = Number(row["i"]);
      if (Number.isInteger(i)) results.set(i, row["ok"] === true ? true : row["ok"] === false ? false : null);
    }
    const { owed, unknown } = owedFromMarkers(migrations, results);
    return { method: "markers", how: `Each of the ${query.indexes.length} markers in ${migrations.verify!.path} checked against the database's catalog.`, checked: query.indexes.length, owed, unknown };
  }
  if (migrations.style === "supabase-cli") {
    const res = await callJson<Array<Record<string, unknown>>>("Supabase", `${API}/v1/projects/${encodeURIComponent(ref)}/database/migrations`, { authorization: `Bearer ${token}` }, ctx);
    const applied = new Set((res.body ?? []).map((m) => String(m["version"] ?? "")).filter(Boolean));
    return { method: "history", how: "The repository's migration files compared with the project's migration history.", checked: migrations.files.length, owed: owedFromHistory(migrations, applied), unknown: [] };
  }
  return { method: "none", how: "The repository has no verify.sql with markers, so birdsI cannot tell which migrations ran. Add one in the marker shape of birdsI's own supabase/verify.sql.", checked: 0, owed: [], unknown: [] };
}
