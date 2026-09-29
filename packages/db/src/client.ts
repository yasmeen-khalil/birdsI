import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase client using the service role key. It bypasses row
 * level security, so every function in this package takes the acting user
 * and checks ownership itself. Never import this from client components.
 */
export type Db = SupabaseClient;

let cached: Db | null = null;

export function getDb(): Db {
  if (cached) return cached;
  const url = process.env["SUPABASE_URL"] ?? process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const key = process.env["SUPABASE_SECRET_KEY"] ?? process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY must be set (see .env.example).");
  }
  cached = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return cached;
}

export function isDbConfigured(): boolean {
  return Boolean((process.env["SUPABASE_URL"] ?? process.env["NEXT_PUBLIC_SUPABASE_URL"]) && (process.env["SUPABASE_SECRET_KEY"] ?? process.env["SUPABASE_SERVICE_ROLE_KEY"]));
}

export class NotFoundError extends Error {
  override name = "NotFoundError";
}

export class ForbiddenError extends Error {
  override name = "ForbiddenError";
}

export function unwrap<T>(result: { data: T | null; error: { message: string } | null }, context: string): T {
  if (result.error) throw new Error(`${context}: ${result.error.message}`);
  if (result.data === null) throw new NotFoundError(context);
  return result.data;
}
