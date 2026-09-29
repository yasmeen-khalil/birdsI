import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

export interface RemoteRef {
  host: string;
  owner: string;
  name: string;
  /** owner/name */
  fullName: string;
}

/**
 * Parses a git remote URL into host and owner/name. Handles https (with or
 * without credentials), ssh://, git://, and scp-style git@host:owner/name.
 */
export function parseRemoteUrl(input: string): RemoteRef | null {
  const url = input.trim();
  if (url === "") return null;
  let host: string;
  let path: string;

  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/\/)(.+)$/.exec(url);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (!["https:", "http:", "ssh:", "git:", "git+ssh:", "ssh+git:"].includes(parsed.protocol)) return null;
    host = parsed.hostname;
    path = decodeURIComponent(parsed.pathname);
  } else if (scp && scp[1] && scp[2]) {
    host = scp[1];
    path = scp[2];
  } else {
    return null;
  }

  const parts = path
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "")
    .split("/")
    .filter((p) => p !== "");
  if (parts.length < 2) return null;
  const name = parts[parts.length - 1];
  const owner = parts[parts.length - 2];
  if (!name || !owner) return null;
  if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(name)) return null;
  return { host: host.toLowerCase(), owner, name, fullName: `${owner}/${name}` };
}

export interface GitInfo {
  /** Working tree root that holds .git. */
  root: string;
  remote: RemoteRef | null;
  /** Null when HEAD is detached. */
  branch: string | null;
  commitSha: string | null;
}

/** Finds the enclosing git work tree and reads remote, branch and HEAD without running git where possible. */
export async function readGitInfo(start: string): Promise<GitInfo | null> {
  const found = await findGitDir(resolve(start));
  if (!found) return null;
  const { root, gitDir, commonDir } = found;

  let head: string;
  try {
    head = (await readFile(join(gitDir, "HEAD"), "utf8")).trim();
  } catch {
    return null;
  }

  let branch: string | null = null;
  let commitSha: string | null = null;
  const refMatch = /^ref:\s*(.+)$/.exec(head);
  if (refMatch && refMatch[1]) {
    const ref = refMatch[1].trim();
    branch = ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
    commitSha = await resolveRef(gitDir, commonDir, ref);
    if (commitSha === null) commitSha = await gitOutput(root, ["rev-parse", "--verify", "-q", "HEAD"]);
  } else if (/^[0-9a-f]{40,64}$/i.test(head)) {
    commitSha = head.toLowerCase();
  }

  let remote: RemoteRef | null = null;
  try {
    const config = await readFile(join(commonDir, "config"), "utf8");
    const url = parseGitConfigRemote(config, "origin");
    if (url) remote = parseRemoteUrl(url);
  } catch {
    // No config: no remote.
  }
  return { root, remote, branch, commitSha };
}

/** Reads `url` from [remote "<name>"] in a git config file. */
export function parseGitConfigRemote(config: string, remoteName: string): string | null {
  let inSection = false;
  for (const rawLine of config.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#") || line.startsWith(";")) continue;
    const section = /^\[\s*([^\s\]"]+)(?:\s+"([^"]*)")?\s*\]$/.exec(line);
    if (section) {
      inSection = section[1]?.toLowerCase() === "remote" && section[2] === remoteName;
      continue;
    }
    if (!inSection) continue;
    const kv = /^url\s*=\s*(.*)$/i.exec(line);
    if (kv && kv[1] !== undefined) return kv[1].replace(/^"(.*)"$/, "$1").trim();
  }
  return null;
}

async function findGitDir(start: string): Promise<{ root: string; gitDir: string; commonDir: string } | null> {
  let dir = start;
  for (;;) {
    const candidate = join(dir, ".git");
    const info = await stat(candidate).catch(() => null);
    if (info?.isDirectory()) return { root: dir, gitDir: candidate, commonDir: candidate };
    if (info?.isFile()) {
      // Worktrees and submodules: ".git" is a file pointing at the real git dir.
      const text = await readFile(candidate, "utf8").catch(() => "");
      const match = /^gitdir:\s*(.+)$/m.exec(text);
      if (match && match[1]) {
        const gitDir = resolvePath(dir, match[1].trim());
        let commonDir = gitDir;
        const common = await readFile(join(gitDir, "commondir"), "utf8").catch(() => null);
        if (common) commonDir = resolvePath(gitDir, common.trim());
        return { root: dir, gitDir, commonDir };
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function resolvePath(base: string, p: string): string {
  return isAbsolute(p) ? p : resolve(base, p);
}

async function resolveRef(gitDir: string, commonDir: string, ref: string): Promise<string | null> {
  for (const dir of gitDir === commonDir ? [gitDir] : [gitDir, commonDir]) {
    const loose = await readFile(join(dir, ref), "utf8").catch(() => null);
    if (loose) {
      const value = loose.trim();
      if (/^[0-9a-f]{40,64}$/i.test(value)) return value.toLowerCase();
      const nested = /^ref:\s*(.+)$/.exec(value);
      if (nested && nested[1]) return resolveRef(gitDir, commonDir, nested[1].trim());
    }
  }
  const packed = await readFile(join(commonDir, "packed-refs"), "utf8").catch(() => null);
  if (packed) {
    for (const line of packed.split(/\r?\n/)) {
      const match = /^([0-9a-f]{40,64})\s+(\S+)$/i.exec(line.trim());
      if (match && match[2] === ref && match[1]) return match[1].toLowerCase();
    }
  }
  return null;
}

/** Runs git and returns trimmed stdout, or null when git is missing or fails. */
export function gitOutput(cwd: string, args: string[]): Promise<string | null> {
  return new Promise((resolvePromise) => {
    execFile("git", args, { cwd, timeout: 10_000 }, (error, stdout) => {
      if (error) return resolvePromise(null);
      const out = stdout.trim();
      resolvePromise(out === "" ? null : out);
    });
  });
}

/** A short display name for the scanned folder: the remote repo name, or the folder name. */
export function displayName(path: string, git: GitInfo | null): string {
  return git?.remote?.name ?? basename(resolve(path));
}
