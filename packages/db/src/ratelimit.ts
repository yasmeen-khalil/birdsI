import { createHash } from "node:crypto";
import { getDb } from "./client";

function hashClient(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 32);
}

/**
 * Sign-in starts are rate limited per client through the demo_requests log,
 * under their own prefix. The table kept its name from the sample scan that
 * birdsI used to run for visitors, removed in v3.
 */
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
