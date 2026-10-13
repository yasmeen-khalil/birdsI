import { createHash } from "node:crypto";
import { getDb } from "./client";

function hashClient(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 32);
}

/**
 * Demo scans run without sign-in, so they are capped per client and globally.
 * Returns false when the caller should be shown the most recent finished demo instead.
 */
export async function allowDemo(clientKey: string, limits: { perClientPerHour: number; globalPerHour: number }): Promise<{ allowed: boolean; reason: "ok" | "client" | "global" }> {
  const db = getDb();
  const since = new Date(Date.now() - 3_600_000).toISOString();
  const hash = hashClient(clientKey);
  const mine = await db.from("demo_requests").select("at", { count: "exact", head: true }).eq("client_hash", hash).gte("at", since);
  if (mine.error) throw new Error(`allowDemo: ${mine.error.message}`);
  if ((mine.count ?? 0) >= limits.perClientPerHour) return { allowed: false, reason: "client" };
  const all = await db.from("demo_requests").select("at", { count: "exact", head: true }).gte("at", since).not("client_hash", "like", `${DEVICE_PREFIX}%`);
  if (all.error) throw new Error(`allowDemo: ${all.error.message}`);
  if ((all.count ?? 0) >= limits.globalPerHour) return { allowed: false, reason: "global" };
  const { error } = await db.from("demo_requests").insert({ client_hash: hash });
  if (error) throw new Error(`allowDemo insert: ${error.message}`);
  return { allowed: true, reason: "ok" };
}

/** Sign-in starts share the request log with demo scans, under their own prefix, and never count against the demo. */
const DEVICE_PREFIX = "device:";

/** Starting a terminal sign-in needs no account, so each client may start only so many an hour. */
export async function allowDeviceStart(clientKey: string, perClientPerHour: number): Promise<boolean> {
  const db = getDb();
  const since = new Date(Date.now() - 3_600_000).toISOString();
  const hash = `${DEVICE_PREFIX}${hashClient(clientKey)}`;
  const mine = await db.from("demo_requests").select("at", { count: "exact", head: true }).eq("client_hash", hash).gte("at", since);
  if (mine.error) throw new Error(`allowDeviceStart: ${mine.error.message}`);
  if ((mine.count ?? 0) >= perClientPerHour) return false;
  const { error } = await db.from("demo_requests").insert({ client_hash: hash });
  if (error) throw new Error(`allowDeviceStart insert: ${error.message}`);
  return true;
}

export async function latestDemoScanId(): Promise<string | null> {
  const db = getDb();
  const { data, error } = await db.from("scans").select("id").eq("source", "demo").eq("status", "done").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`latestDemoScanId: ${error.message}`);
  return (data as { id: string } | null)?.id ?? null;
}

export async function latestDoneDemoScan(): Promise<{ id: string; created_at: string } | null> {
  const db = getDb();
  const { data, error } = await db.from("scans").select("id, created_at").eq("source", "demo").eq("status", "done").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`latestDoneDemoScan: ${error.message}`);
  return (data as { id: string; created_at: string } | null) ?? null;
}
