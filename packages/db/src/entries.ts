import type { AddEntryRequest, AppEntry } from "@birdsi/shared";
import { ownedApp } from "./alerts";
import { getDb, NotFoundError } from "./client";
import { schemaHas } from "./schema";

/**
 * What no API reports, entered by the owner. The table appears with
 * migration 20261027000000; until then the Projects page says why.
 */

export const ENTRIES_MIGRATION = "20261027000000_manual_entries.sql";

interface EntryRow {
  id: string;
  app_id: string;
  vendor: string | null;
  kind: AppEntry["kind"];
  label: string;
  amount_usd: string | number | null;
  period: AppEntry["period"];
  renews_on: string | null;
  note: string | null;
  created_at: string;
}

export function entriesAvailable(): Promise<boolean> {
  return schemaHas("app_entries");
}

function toEntry(row: EntryRow): AppEntry {
  return { id: row.id, appId: row.app_id, vendor: row.vendor, kind: row.kind, label: row.label, amountUsd: row.amount_usd === null ? null : Number(row.amount_usd), period: row.period, renewsOn: row.renews_on, note: row.note, createdAt: row.created_at };
}

export async function entriesForApp(appId: string): Promise<AppEntry[]> {
  if (!(await entriesAvailable())) return [];
  const { data, error } = await getDb().from("app_entries").select().eq("app_id", appId).order("created_at", { ascending: false });
  if (error) throw new Error(`entriesForApp: ${error.message}`);
  return ((data ?? []) as EntryRow[]).map(toEntry);
}

export async function addEntry(appId: string, userId: string, input: AddEntryRequest): Promise<AppEntry> {
  await ownedApp(appId, userId);
  const { data, error } = await getDb()
    .from("app_entries")
    .insert({ app_id: appId, vendor: input.vendor, kind: input.kind, label: input.label, amount_usd: input.amountUsd, period: input.period, renews_on: input.renewsOn, note: input.note })
    .select()
    .single();
  if (error) throw new Error(`addEntry: ${error.message}`);
  return toEntry(data as EntryRow);
}

export async function removeEntry(entryId: string, userId: string): Promise<AppEntry> {
  const { data, error } = await getDb().from("app_entries").select().eq("id", entryId).maybeSingle();
  if (error) throw new Error(`removeEntry: ${error.message}`);
  if (!data) throw new NotFoundError("entry");
  const row = data as EntryRow;
  await ownedApp(row.app_id, userId);
  const del = await getDb().from("app_entries").delete().eq("id", entryId);
  if (del.error) throw new Error(`removeEntry: ${del.error.message}`);
  return toEntry(row);
}
