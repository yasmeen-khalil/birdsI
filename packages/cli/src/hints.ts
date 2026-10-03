import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectHints } from "@birdsi/shared";

/**
 * Facts that only exist on the owner's machine. Today: Stripe Projects,
 * which provisions and bills services from the terminal and can report the
 * plan and spend per provider. Nothing here needs a network call of its own;
 * the Stripe CLI uses the login it already has.
 */
const COMMAND_TIMEOUT_MS = 15_000;

function run(command: string, args: string[], cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      execFile(command, args, { cwd, timeout: COMMAND_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, NO_COLOR: "1" } }, (error, stdout) => {
        resolve(error ? null : stdout);
      });
    } catch {
      resolve(null);
    }
  });
}

function parseJson(text: string | null): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export async function collectHints(root: string): Promise<ProjectHints | null> {
  let state: unknown;
  try {
    state = JSON.parse(await readFile(join(root, ".projects", "state.json"), "utf8"));
  } catch {
    state = undefined;
  }
  let status: unknown;
  let spend: unknown;
  if (state !== undefined) {
    status = parseJson(await run("stripe", ["projects", "status", "--json", "--no-interactive"], root));
    spend = parseJson(await run("stripe", ["projects", "spend", "--json", "--no-interactive"], root));
  }
  if (state === undefined && status === undefined && spend === undefined) return null;
  return {
    stripeProjects: {
      ...(state !== undefined ? { state } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(spend !== undefined ? { spend } : {}),
      collectedAt: new Date().toISOString(),
    },
  };
}
