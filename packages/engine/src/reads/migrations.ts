import type { MapMigrations, MigrationMarker, OwedMigration } from "@birdsi/shared";

/**
 * Which of an app's migrations its database still owes, from the markers in
 * the app's own verify.sql (read by the map) checked against the database's
 * catalog, the way the app's verify.sql does it when the owner pastes it.
 * The query reads only the catalog (information_schema, pg_catalog's pg_proc,
 * pg_namespace, pg_description and pg_class) and storage bucket settings,
 * never a row of the app's own tables.
 */

export const MARKER_KINDS = ["table", "column", "function", "comment", "table_comment", "no_table", "no_column", "bucket", "bucket_type"] as const;
type MarkerKind = (typeof MARKER_KINDS)[number];

const MAX_MARKERS = 400;
const SAFE = /^[\x20-\x7e]{1,200}$/;

function literal(value: string | null): string {
  return value === null ? "null::text" : `'${value.replace(/'/g, "''")}'`;
}

/** A marker birdsI can check: a known kind, printable names of a sane length. */
export function checkable(m: MigrationMarker): boolean {
  if (!(MARKER_KINDS as readonly string[]).includes(m.kind)) return false;
  if (!SAFE.test(m.name)) return false;
  if (m.col !== null && !SAFE.test(m.col)) return false;
  if ((m.kind === "column" || m.kind === "no_column" || m.kind === "comment" || m.kind === "table_comment" || m.kind === "bucket_type") && m.col === null) return false;
  return true;
}

// Every name is schema qualified: Supabase's read-only endpoint requires it.
const CHECK: Record<MarkerKind, string> = {
  table: "exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = m.name)",
  column: "exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = m.name and column_name = m.col)",
  function: "exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = m.name)",
  comment: "exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_description d on d.objoid = p.oid where p.proname = m.name and d.description like m.col || '%')",
  table_comment: "exists (select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = m.name and pg_catalog.obj_description(c.oid, 'pg_class') like m.col || '%')",
  no_table: "not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = m.name)",
  no_column: "not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = m.name and column_name = m.col)",
  bucket: "exists (select 1 from storage.buckets where id = m.name)",
  bucket_type: "exists (select 1 from storage.buckets where id = m.name and allowed_mime_types = array[m.col] and file_size_limit is not null)",
};

/** One read-only query over the catalog: a row per marker with its index and whether the database has it. */
export function markerQuery(markers: MigrationMarker[]): { sql: string; indexes: number[] } | null {
  const indexes = markers.map((m, i) => (checkable(m) ? i : -1)).filter((i) => i >= 0).slice(0, MAX_MARKERS);
  if (indexes.length === 0) return null;
  const kinds = [...new Set(indexes.map((i) => markers[i]!.kind as MarkerKind))];
  const values = indexes.map((i) => `(${i}, ${literal(markers[i]!.kind)}, ${literal(markers[i]!.name)}, ${literal(markers[i]!.col)})`).join(",\n    ");
  const cases = kinds.map((k) => `    when m.kind = '${k}' then ${CHECK[k]}`).join("\n");
  const sql = `with markers (i, kind, name, col) as (\n  values\n    ${values}\n)\nselect m.i, case\n${cases}\n    else null\n  end as ok\nfrom markers m\norder by m.i`;
  return { sql, indexes };
}

/** The migration file a marker's label names: "v73 ..." is supabase-v73.sql, "0013 ..." is 0013_*.sql, a timestamp is its CLI file, "base" the base schema. */
export function fileForLabel(label: string, files: MapMigrations["files"]): MapMigrations["files"][number] | null {
  const token = label.trim().split(/[\s:]+/)[0]?.toLowerCase() ?? "";
  if (!token) return null;
  const v = /^v(\d+)$/.exec(token);
  if (v) return files.find((f) => new RegExp(`(^|[-_])v${Number(v[1])}\\.sql$`, "i").test(f.name)) ?? null;
  if (/^\d{3,5}$/.test(token) || /^\d{14}$/.test(token)) return files.find((f) => f.name.startsWith(`${token}_`) || f.name.startsWith(`${token}-`)) ?? null;
  if (token === "base") return files.find((f) => /schema\.sql$/i.test(f.name)) ?? null;
  return null;
}

export function describeMarker(m: MigrationMarker): string {
  switch (m.kind) {
    case "table":
      return `the table ${m.name}`;
    case "column":
      return `the column ${m.name}.${m.col}`;
    case "function":
      return `the function ${m.name}`;
    case "comment":
      return `the function ${m.name} marked ${m.col}`;
    case "table_comment":
      return `the table ${m.name} marked ${m.col}`;
    case "no_table":
      return `the table ${m.name} removed`;
    case "no_column":
      return `the column ${m.name}.${m.col} removed`;
    case "bucket":
      return `the storage bucket ${m.name}`;
    case "bucket_type":
      return `the storage bucket ${m.name} taking only ${m.col}`;
    default:
      return `${m.kind} ${m.name}${m.col ? `.${m.col}` : ""}`;
  }
}

/**
 * Groups the markers the database lacks by the migration that adds them, in
 * the order of the repository's files: the oldest owed migration first.
 */
export function owedFromMarkers(migrations: MapMigrations, results: Map<number, boolean | null>): { owed: OwedMigration[]; unknown: string[] } {
  const markers = migrations.verify?.markers ?? [];
  const byLabel = new Map<string, OwedMigration>();
  const unknown: string[] = [];
  markers.forEach((m, i) => {
    const ok = results.get(i);
    if (ok === undefined || ok === null) {
      unknown.push(`${m.migration}: ${describeMarker(m)}`);
      return;
    }
    if (ok) return;
    const file = fileForLabel(m.migration, migrations.files);
    const key = file?.name ?? m.migration;
    const entry = byLabel.get(key) ?? { migration: file?.name ?? m.migration, file: file?.path ?? null, missing: [] };
    entry.missing.push(describeMarker(m));
    byLabel.set(key, entry);
  });
  const order = (o: OwedMigration) => {
    const i = migrations.files.findIndex((f) => f.path === o.file);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return { owed: [...byLabel.values()].sort((a, b) => order(a) - order(b) || a.migration.localeCompare(b.migration)), unknown };
}

/** For Supabase CLI migrations without markers: the files whose timestamp the project's migration history lacks. */
export function owedFromHistory(migrations: MapMigrations, applied: Set<string>): OwedMigration[] {
  return migrations.files
    .map((f) => ({ f, version: /^(\d{14})_/.exec(f.name)?.[1] ?? null }))
    .filter((x) => x.version !== null && !applied.has(x.version))
    .map((x) => ({ migration: x.f.name, file: x.f.path, missing: [`version ${x.version} in the project's migration history`] }));
}
