import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { env } from "./env";

/**
 * Sample scans need no account, so the browser that started one gets a
 * signed cookie naming it. Only that browser may stop it.
 */
const COOKIE = "birdsi_demo";

function signature(scanId: string): string | null {
  const key = env("BIRDSI_SECRETS_KEY") ?? env("CLERK_SECRET_KEY");
  if (!key) return null;
  return createHmac("sha256", key).update(`demo-owner:${scanId}`).digest("base64url");
}

/** The cookie to set on the response that started a sample scan; null when no server key is configured. */
export function demoOwnerCookie(scanId: string): { name: string; value: string; options: { httpOnly: true; sameSite: "lax"; secure: boolean; path: string; maxAge: number } } | null {
  const sig = signature(scanId);
  if (!sig) return null;
  return { name: COOKIE, value: `${scanId}.${sig}`, options: { httpOnly: true, sameSite: "lax", secure: process.env["NODE_ENV"] === "production", path: "/", maxAge: 6 * 3600 } };
}

/** True when this browser started the sample scan. */
export async function startedThisDemo(scanId: string): Promise<boolean> {
  const raw = (await cookies()).get(COOKIE)?.value;
  const sig = signature(scanId);
  if (!raw || !sig) return false;
  const dot = raw.lastIndexOf(".");
  if (raw.slice(0, dot) !== scanId) return false;
  const a = Buffer.from(raw.slice(dot + 1));
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}
