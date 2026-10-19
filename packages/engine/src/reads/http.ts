import type { Reading, ReadSource } from "@birdsi/shared";

/**
 * The plumbing every project reader shares: one call with a timeout, a
 * reason a person can act on for every failure, and each part of a read
 * kept apart, so one part that could not be read never hides the others or
 * turns into a zero.
 */

export interface ReadContext {
  now: Date;
  signal?: AbortSignal;
}

/** A failure with the sentence the cockpit shows. */
export class ReadError extends Error {
  override name = "ReadError";
}

export const READ_TIMEOUT_MS = 20_000;

export function reasonForStatus(vendor: string, status: number): string {
  if (status === 401) return `${vendor} refused the key (HTTP 401). It may have expired or been revoked. Replace it on the Projects page.`;
  if (status === 403) return `${vendor} refused the key for this (HTTP 403). The key lacks read access to it. Make a key with that access and replace it on the Projects page.`;
  if (status === 404) return `${vendor} found nothing at this id for this key (HTTP 404). Check the id on the Projects page.`;
  if (status === 429) return `${vendor} asked birdsI to slow down (HTTP 429). The next read tries again.`;
  if (status >= 500) return `${vendor} had an error on its side (HTTP ${status}). The next read tries again.`;
  return `${vendor} answered HTTP ${status}.`;
}

export interface CallOptions {
  method?: "GET" | "POST";
  body?: unknown;
  timeoutMs?: number;
  /** Statuses that are an answer rather than a failure, returned with a null body. */
  allow?: number[];
}

/** One call to a vendor's API. Throws a ReadError with a plain reason on any failure. */
export async function callJson<T>(vendor: string, url: string, headers: Record<string, string>, ctx: ReadContext, options: CallOptions = {}): Promise<{ status: number; body: T | null }> {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? READ_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  ctx.signal?.addEventListener("abort", onAbort, { once: true });
  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? "GET",
      headers: { accept: "application/json", ...(options.body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timer);
    ctx.signal?.removeEventListener("abort", onAbort);
    if (controller.signal.aborted && !ctx.signal?.aborted) throw new ReadError(`${vendor} did not answer within ${Math.round(timeoutMs / 1000)} seconds. The next read tries again.`);
    throw new ReadError(`birdsI could not reach ${vendor} (${error instanceof Error ? error.message.slice(0, 120) : String(error)}).`);
  }
  try {
    const text = await response.text();
    if (options.allow?.includes(response.status)) return { status: response.status, body: null };
    if (!response.ok) throw new ReadError(reasonForStatus(vendor, response.status));
    if (!text) return { status: response.status, body: null };
    try {
      return { status: response.status, body: JSON.parse(text) as T };
    } catch {
      throw new ReadError(`${vendor} answered with something other than JSON.`);
    }
  } catch (error) {
    if (error instanceof ReadError) throw error;
    throw new ReadError(`${vendor}'s answer could not be read (${error instanceof Error ? error.message.slice(0, 120) : String(error)}).`);
  } finally {
    clearTimeout(timer);
    ctx.signal?.removeEventListener("abort", onAbort);
  }
}

/** Runs one part of a read and dates it: its value, or the reason it could not be read. Never a zero for a failure. */
export async function reading<T>(source: ReadSource, _ctx: ReadContext, part: () => Promise<T>): Promise<Reading<T>> {
  try {
    const value = await part();
    return { ok: true, readAt: new Date().toISOString(), source, value };
  } catch (error) {
    const reason = error instanceof ReadError ? error.message : `The read stopped on an unexpected answer (${error instanceof Error ? error.message.slice(0, 160) : String(error)}).`;
    return { ok: false, readAt: new Date().toISOString(), source, reason };
  }
}

/** A part that was not read because an earlier one failed, with that reason. */
export function notRead<T>(source: ReadSource, reason: string): Reading<T> {
  return { ok: false, readAt: new Date().toISOString(), source, reason };
}

/** Picks only the named fields of an object: the readers keep an allowlist, so a credential a vendor adds to an answer is never stored. */
export function pick<T extends Record<string, unknown>, K extends string>(value: T | null | undefined, keys: readonly K[]): Partial<Record<K, unknown>> {
  const out: Partial<Record<K, unknown>> = {};
  if (!value || typeof value !== "object") return out;
  for (const k of keys) if (k in value) out[k] = value[k];
  return out;
}

export function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function iso(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value > 1e12 ? value : value * 1000).toISOString();
  if (typeof value === "string" && value) {
    const t = Date.parse(value);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }
  return null;
}
