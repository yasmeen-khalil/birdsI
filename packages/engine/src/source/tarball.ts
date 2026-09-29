import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extract } from "tar";
import type { Snapshot } from "./types";

export const MAX_SNAPSHOT_BYTES = 200 * 1024 * 1024;
export const MAX_SNAPSHOT_FILES = 40_000;

/**
 * Extracts a gzipped tarball into a fresh temp directory. GitHub tarballs and
 * CLI uploads both wrap the tree in a single top folder, which is unwrapped.
 * Entries are filtered so an archive can never write outside its own root.
 */
export async function snapshotFromTarball(
  tarballPath: string,
  meta: { fullName: string | null; branch: string | null; commitSha: string | null },
): Promise<Snapshot> {
  const dir = await mkdtemp(join(tmpdir(), "birdsi-"));
  let files = 0;
  let bytes = 0;
  await extract({
    file: tarballPath,
    cwd: dir,
    strip: 0,
    preservePaths: false,
    filter: (path, entry) => {
      if (path.includes("..")) return false;
      const type = "type" in entry ? entry.type : "File";
      if (type === "SymbolicLink" || type === "Link") return false;
      if (type === "File") {
        files += 1;
        bytes += entry.size ?? 0;
        if (files > MAX_SNAPSHOT_FILES || bytes > MAX_SNAPSHOT_BYTES) return false;
      }
      return true;
    },
  });
  const root = await unwrapSingleFolder(dir);
  return {
    root,
    fullName: meta.fullName,
    branch: meta.branch,
    commitSha: meta.commitSha,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

async function unwrapSingleFolder(dir: string): Promise<string> {
  const entries = await readdir(dir);
  if (entries.length !== 1) return dir;
  const only = join(dir, entries[0]!);
  const info = await stat(only);
  return info.isDirectory() ? only : dir;
}

/** Wraps an existing directory (the CLI's own working tree, a fixture) without copying. */
export function snapshotFromDirectory(root: string, meta: Partial<Omit<Snapshot, "root" | "cleanup">> = {}): Snapshot {
  return {
    root,
    fullName: meta.fullName ?? null,
    branch: meta.branch ?? null,
    commitSha: meta.commitSha ?? null,
    cleanup: async () => {},
  };
}
