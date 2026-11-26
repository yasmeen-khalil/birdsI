/** Server-side environment access with one place to document each key. */
export function env(name: string): string | null {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : null;
}

export function envInt(name: string, fallback: number): number {
  const raw = env(name);
  if (raw === null) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function appUrl(): string {
  return env("NEXT_PUBLIC_APP_URL") ?? (env("VERCEL_URL") ? `https://${env("VERCEL_URL")}` : "http://localhost:3000");
}
