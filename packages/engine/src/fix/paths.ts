import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

function inside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel !== "" && !rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel);
}

/**
 * Resolves a repository-relative path against the snapshot root and returns
 * the absolute path only when it stays inside the root, symlinks included.
 * Paths come from model output, so anything that escapes is refused.
 */
export async function resolveInsideRoot(root: string, path: string): Promise<string | null> {
  if (!path || path.includes("\0") || isAbsolute(path)) return null;
  const base = resolve(root);
  const target = resolve(base, path);
  if (!inside(base, target)) return null;
  let realBase: string;
  try {
    realBase = await realpath(base);
  } catch {
    return null;
  }
  try {
    const realTarget = await realpath(target);
    return inside(realBase, realTarget) ? realTarget : null;
  } catch {
    // A missing file is fine to report as missing; the lexical check above already holds.
    return target;
  }
}
