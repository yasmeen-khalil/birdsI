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

/** Which integrations are configured. Shown in Settings and used to degrade gracefully. */
export function integrationStatus() {
  return {
    database: Boolean(env("SUPABASE_URL") && env("SUPABASE_SECRET_KEY")),
    clerk: Boolean(env("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY") && env("CLERK_SECRET_KEY")),
    secretsKey: Boolean(env("BIRDSI_SECRETS_KEY") && env("BIRDSI_SECRETS_KEY")!.length >= 16),
    docsCheck: Boolean(env("ANTHROPIC_API_KEY") && env("TAVILY_API_KEY")),
    github: Boolean(env("GITHUB_APP_ID") && env("GITHUB_APP_PRIVATE_KEY") && env("GITHUB_APP_SLUG")),
  };
}
