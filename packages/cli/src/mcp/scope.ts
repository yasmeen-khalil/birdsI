import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, parse, resolve, sep } from "node:path";
import { CliError, EXIT } from "../exit";
import { readGitInfo } from "../git";

/**
 * The folders an agent may ask birdsI to upload: the folder the MCP server
 * was started in, and the git repository around it. The filesystem root and
 * the home folder never count as a project, so an agent started there can
 * only scan inside a git repository.
 */
export async function allowedScanRoot(requested: string, cwd: string = process.cwd(), home: string = homedir()): Promise<string> {
  const target = await realpath(isAbsolute(requested) ? requested : resolve(cwd, requested)).catch(() => null);
  if (!target) throw new CliError(`There is no folder at ${requested}.`, EXIT.usage);
  const tooWide = new Set([parse(target).root, await realpath(home).catch(() => home)]);
  const bases: string[] = [];
  const here = await realpath(cwd).catch(() => null);
  if (here) bases.push(here);
  const git = here ? await readGitInfo(here) : null;
  if (git) bases.push(await realpath(git.root).catch(() => git.root));
  const allowed = bases.filter((b) => !tooWide.has(b)).some((b) => target === b || target.startsWith(b.endsWith(sep) ? b : b + sep));
  if (!allowed) {
    throw new CliError(
      "birdsI scans only the folder this agent was started in, or the git repository around it.",
      EXIT.usage,
      "Start the agent in the project folder, or run npx birdsi there.",
    );
  }
  return target;
}
