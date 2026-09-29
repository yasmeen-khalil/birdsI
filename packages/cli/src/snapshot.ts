import { rmSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative, sep } from "node:path";
import ignore, { type Ignore } from "ignore";
import { create as createTar } from "tar";
import { CliError, EXIT } from "./exit";

/**
 * Folders and file types never worth sending; matched at any depth.
 * Mirrors the engine's built-in list, except lockfiles: the server parses
 * them for exact dependency versions, so they must be in the snapshot.
 */
export const ALWAYS_IGNORED: readonly string[] = [
  ".git/",
  "node_modules/",
  ".next/",
  ".nuxt/",
  ".svelte-kit/",
  ".turbo/",
  ".cache/",
  "dist/",
  "build/",
  "out/",
  "coverage/",
  ".venv/",
  "venv/",
  "__pycache__/",
  ".mypy_cache/",
  ".pytest_cache/",
  "target/",
  "vendor/",
  ".terraform/",
  "Pods/",
  ".gradle/",
  ".idea/",
  ".vscode/",
  ".DS_Store",
  "*.min.js",
  "*.min.css",
  "*.map",
  "*.png",
  "*.jpg",
  "*.jpeg",
  "*.gif",
  "*.webp",
  "*.ico",
  "*.svg",
  "*.pdf",
  "*.zip",
  "*.gz",
  "*.tar",
  "*.woff",
  "*.woff2",
  "*.ttf",
  "*.otf",
  "*.mp4",
  "*.mp3",
  "*.wasm",
  "*.exe",
  "*.dll",
  "*.so",
  "*.dylib",
  "*.pyc",
  "*.class",
  "*.jar",
];

/** Lockfiles are always kept (below the size cap) even when large. */
export const LOCKFILES: readonly string[] = [
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "poetry.lock",
  "Pipfile.lock",
  "uv.lock",
  "Gemfile.lock",
  "Cargo.lock",
  "composer.lock",
  "go.sum",
  "mix.lock",
  "pubspec.lock",
  "packages.lock.json",
];

export const LIMITS = {
  maxTotalBytes: 200 * 1024 * 1024,
  maxFiles: 40_000,
  /** Single files above this are skipped (the server does not read them either); lockfiles get a larger allowance. */
  maxFileBytes: 2 * 1024 * 1024,
  maxLockfileBytes: 20 * 1024 * 1024,
};

/** Top folder every entry sits under inside the tarball. */
export const SNAPSHOT_PREFIX = "snapshot/";

export interface WalkResult {
  root: string;
  /** Root-relative paths with forward slashes, sorted. */
  files: string[];
  totalBytes: number;
  /** Files left out: ignored, symlinks, or over the single-file size cap. */
  skipped: number;
  /** Files left out only because they were too large, for the user to know. */
  tooLarge: string[];
}

interface IgnoreLayer {
  ig: Ignore;
  /** Directory the rules are relative to, root-relative ("" for the root). */
  dir: string;
}

export interface WalkOptions {
  limits?: Partial<typeof LIMITS>;
}

/** Walks a folder honouring .gitignore files at every level plus the built-in ignore list. */
export async function walkSnapshot(root: string, options: WalkOptions = {}): Promise<WalkResult> {
  const limits = { ...LIMITS, ...options.limits };
  const rootInfo = await stat(root).catch(() => null);
  if (!rootInfo) throw new CliError(`There is no folder at ${root}.`, EXIT.usage);
  if (!rootInfo.isDirectory()) throw new CliError(`${root} is a file. Point birdsI at a folder.`, EXIT.usage);

  const result: WalkResult = { root, files: [], totalBytes: 0, skipped: 0, tooLarge: [] };
  const base: IgnoreLayer = { ig: ignore().add([...ALWAYS_IGNORED]), dir: "" };
  await walkDir(root, root, [base], result, limits);
  result.files.sort();
  return result;
}

function toPosix(p: string): string {
  return p.split(sep).join("/");
}

async function walkDir(
  root: string,
  dir: string,
  layers: IgnoreLayer[],
  out: WalkResult,
  limits: typeof LIMITS,
): Promise<void> {
  const dirRel = toPosix(relative(root, dir));
  let localLayers = layers;
  const rules = await readFile(join(dir, ".gitignore"), "utf8").catch(() => null);
  if (rules !== null) localLayers = [...layers, { ig: ignore().add(rules), dir: dirRel }];

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    out.skipped += 1;
    return;
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const full = join(dir, entry.name);
    const rel = toPosix(relative(root, full));
    if (entry.isSymbolicLink()) {
      out.skipped += 1;
      continue;
    }
    if (entry.isDirectory()) {
      if (isIgnored(localLayers, rel, true)) {
        out.skipped += 1;
        continue;
      }
      await walkDir(root, full, localLayers, out, limits);
      continue;
    }
    if (!entry.isFile()) continue;
    if (isIgnored(localLayers, rel, false)) {
      out.skipped += 1;
      continue;
    }
    const info = await stat(full).catch(() => null);
    if (!info) {
      out.skipped += 1;
      continue;
    }
    const cap = LOCKFILES.includes(basename(rel)) ? limits.maxLockfileBytes : limits.maxFileBytes;
    if (info.size > cap) {
      out.skipped += 1;
      out.tooLarge.push(rel);
      continue;
    }
    out.files.push(rel);
    out.totalBytes += info.size;
    if (out.files.length > limits.maxFiles) {
      throw new CliError(
        `This folder has more than ${limits.maxFiles.toLocaleString("en-US")} files to send, which is more than birdsI accepts in one scan.`,
        EXIT.usage,
        "Scan a smaller folder, or add large generated folders to .gitignore.",
      );
    }
    if (out.totalBytes > limits.maxTotalBytes) {
      throw new CliError(
        `This folder has more than ${formatBytes(limits.maxTotalBytes)} of files to send, which is more than birdsI accepts in one scan.`,
        EXIT.usage,
        "Scan a smaller folder, or add large generated folders and data files to .gitignore.",
      );
    }
  }
}

/** Each .gitignore sees paths relative to its own folder, as git does. */
function isIgnored(layers: IgnoreLayer[], rootRel: string, isDir: boolean): boolean {
  let ignored = false;
  for (const layer of layers) {
    let candidate = rootRel;
    if (layer.dir !== "") {
      if (!rootRel.startsWith(layer.dir + "/")) continue;
      candidate = rootRel.slice(layer.dir.length + 1);
    }
    if (candidate === "") continue;
    const probe = isDir ? candidate + "/" : candidate;
    try {
      // Deeper .gitignore files can re-include what a parent ignored ("!keep.txt").
      const verdict = layer.ig.test(probe);
      if (verdict.ignored) ignored = true;
      else if (verdict.unignored) ignored = false;
    } catch {
      // Paths ignore() refuses are never ignored.
    }
  }
  return ignored;
}

export interface Snapshot {
  walk: WalkResult;
  /** Path of the gzipped tarball on disk. */
  file: string;
  bytes: number;
  /** Removes the temporary tarball. */
  cleanup: () => Promise<void>;
}

/** Walks the folder and writes a gzipped tarball of it to a temp file, entries under snapshot/. */
export async function buildSnapshot(root: string, options: WalkOptions = {}): Promise<Snapshot> {
  const walk = await walkSnapshot(root, options);
  if (walk.files.length === 0) {
    throw new CliError(
      "There are no files to scan in this folder after ignoring build output and .gitignore entries.",
      EXIT.usage,
    );
  }
  const dir = await mkdtemp(join(tmpdir(), "birdsi-"));
  const file = join(dir, "snapshot.tar.gz");
  // Removed even when the process exits mid-upload (Ctrl+C).
  const onExit = (): void => rmSync(dir, { recursive: true, force: true });
  process.once("exit", onExit);
  const cleanup = async (): Promise<void> => {
    process.removeListener("exit", onExit);
    await rm(dir, { recursive: true, force: true });
  };
  try {
    await createTar(
      {
        gzip: { level: 9 },
        file,
        cwd: root,
        prefix: SNAPSHOT_PREFIX,
        portable: true,
        noDirRecurse: true,
        follow: false,
        // A file swapped for a symlink after the walk is still left out.
        filter: (_path, entry) => !("isSymbolicLink" in entry && entry.isSymbolicLink()),
      },
      walk.files,
    );
    const info = await stat(file);
    return { walk, file, bytes: info.size, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
