import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { CliError, EXIT } from "./exit";

export const DEFAULT_API_URL = "https://birdsi.vercel.app";

const StoredConfig = z.object({
  token: z.string().optional(),
  apiUrl: z.string().optional(),
  login: z.string().optional(),
  /** The newest scan started from this computer, so "birdsi explain 3" can refer to its numbered findings. */
  lastScanId: z.string().optional(),
  /** The repository that scan belonged to, so vendors, questions and approvals need no id. */
  lastRepoId: z.string().optional(),
});
export type StoredConfig = z.infer<typeof StoredConfig>;

export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME.trim() !== "" ? env.XDG_CONFIG_HOME : join(homedir(), ".config");
  return join(base, "birdsi", "config.json");
}

export async function readConfig(env: NodeJS.ProcessEnv = process.env): Promise<StoredConfig> {
  let text: string;
  try {
    text = await readFile(configPath(env), "utf8");
  } catch {
    return {};
  }
  try {
    const parsed = StoredConfig.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

/** Writes the whole config atomically, readable only by the current user. */
export async function writeConfig(config: StoredConfig, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const path = configPath(env);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, path);
}

export async function updateConfig(
  patch: Partial<Record<keyof StoredConfig, string | undefined>>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<StoredConfig> {
  const current = await readConfig(env);
  const next: StoredConfig = { ...current };
  for (const [key, value] of Object.entries(patch) as Array<[keyof StoredConfig, string | undefined]>) {
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  if (Object.keys(next).length === 0) {
    await rm(configPath(env), { force: true });
    return next;
  }
  await writeConfig(next, env);
  return next;
}

export interface ResolvedAuth {
  token: string;
  source: "env" | "file";
  login: string | undefined;
}

/** API base URL: BIRDSI_API_URL, then the saved config, then the hosted default. */
export function resolveApiUrl(config: StoredConfig, env: NodeJS.ProcessEnv = process.env): string {
  const raw = (env.BIRDSI_API_URL && env.BIRDSI_API_URL.trim()) || config.apiUrl || DEFAULT_API_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new CliError(`The birdsI address "${raw}" is not a valid URL.`, EXIT.usage, "Check BIRDSI_API_URL.");
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new CliError(
      `The birdsI address must use https, so your token is never sent in the clear: ${raw}`,
      EXIT.usage,
      "Plain http is allowed only for localhost.",
    );
  }
  return url.origin + url.pathname.replace(/\/+$/, "");
}

/** The token to use: BIRDSI_TOKEN wins over the saved file, so CI never needs a login. */
export function resolveAuth(config: StoredConfig, env: NodeJS.ProcessEnv = process.env): ResolvedAuth | null {
  const fromEnv = env.BIRDSI_TOKEN?.trim();
  if (fromEnv) {
    if (!fromEnv.startsWith("bsi_")) {
      throw new CliError(
        "BIRDSI_TOKEN does not look like a birdsI token. birdsI tokens start with bsi_.",
        EXIT.notSignedIn,
      );
    }
    return { token: fromEnv, source: "env", login: undefined };
  }
  if (config.token) return { token: config.token, source: "file", login: config.login };
  return null;
}

export const LOGIN_HINT = "Run birdsi login to sign in, or set BIRDSI_TOKEN.";

export function notSignedIn(): CliError {
  return new CliError("You are not signed in to birdsI.", EXIT.notSignedIn, LOGIN_HINT);
}
