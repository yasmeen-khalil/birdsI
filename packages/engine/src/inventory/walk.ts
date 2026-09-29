import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import ignore, { type Ignore } from "ignore";
import { languageOf } from "./languages";

export interface InventoryFile {
  /** Repo-relative path with forward slashes. */
  path: string;
  bytes: number;
  language: string | null;
}

export interface Inventory {
  root: string;
  files: InventoryFile[];
  /** Files skipped because they were too large, binary, or ignored. */
  skipped: number;
  /** Top-level folder -> file paths, for the bird's-eye map. */
  folders: Array<{ name: string; files: string[] }>;
  languages: Array<{ name: string; files: number }>;
}

/** Folders and file types never worth reading; matched at any depth. */
const ALWAYS_IGNORED = [
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
  "*.lock",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
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

/** Lockfiles are ignored for reading but parsed separately for exact versions. */
export const LOCKFILES = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "poetry.lock", "Pipfile.lock", "Gemfile.lock", "Cargo.lock", "composer.lock", "go.sum"];

const MAX_INVENTORY_FILE_BYTES = 2 * 1024 * 1024;

interface IgnoreLayer {
  ig: Ignore;
  /** Directory the rules are relative to, repo-relative ("" for the root). */
  dir: string;
}

/**
 * Walks a snapshot honouring .gitignore files at every level plus the
 * built-in ignore list. Produces the file list every check works from.
 */
export async function walkInventory(root: string): Promise<Inventory> {
  const files: InventoryFile[] = [];
  let skipped = 0;
  const base: IgnoreLayer = { ig: ignore().add(ALWAYS_IGNORED), dir: "" };
  await walkDir(root, root, [base], files, () => (skipped += 1));
  files.sort((a, b) => a.path.localeCompare(b.path));

  const folderMap = new Map<string, string[]>();
  const langMap = new Map<string, number>();
  for (const file of files) {
    const top = file.path.includes("/") ? file.path.slice(0, file.path.indexOf("/")) : ".";
    const list = folderMap.get(top) ?? [];
    list.push(file.path);
    folderMap.set(top, list);
    if (file.language) langMap.set(file.language, (langMap.get(file.language) ?? 0) + 1);
  }
  const folders = [...folderMap.entries()]
    .map(([name, list]) => ({ name, files: list }))
    .sort((a, b) => (a.name === "." ? 1 : b.name === "." ? -1 : b.files.length - a.files.length));
  const languages = [...langMap.entries()].map(([name, count]) => ({ name, files: count })).sort((a, b) => b.files - a.files);
  return { root, files, skipped, folders, languages };
}

function toPosix(p: string): string {
  return p.split(sep).join("/");
}

async function walkDir(root: string, dir: string, layers: IgnoreLayer[], out: InventoryFile[], skip: () => void): Promise<void> {
  const dirRel = toPosix(relative(root, dir));
  let localLayers = layers;
  try {
    const rules = await readFile(join(dir, ".gitignore"), "utf8");
    localLayers = [...layers, { ig: ignore().add(rules), dir: dirRel }];
  } catch {
    // No .gitignore here.
  }
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    const rel = toPosix(relative(root, full));
    if (entry.isSymbolicLink()) {
      skip();
      continue;
    }
    if (entry.isDirectory()) {
      if (isIgnored(localLayers, rel, true)) {
        skip();
        continue;
      }
      await walkDir(root, full, localLayers, out, skip);
      continue;
    }
    if (!entry.isFile()) continue;
    if (isIgnored(localLayers, rel, false)) {
      skip();
      continue;
    }
    const info = await stat(full);
    if (info.size > MAX_INVENTORY_FILE_BYTES) {
      skip();
      continue;
    }
    out.push({ path: rel, bytes: info.size, language: languageOf(rel) });
  }
}

/** Each .gitignore sees paths relative to its own folder, as git does. */
function isIgnored(layers: IgnoreLayer[], repoRel: string, isDir: boolean): boolean {
  for (const layer of layers) {
    let candidate = repoRel;
    if (layer.dir !== "") {
      if (!repoRel.startsWith(layer.dir + "/")) continue;
      candidate = repoRel.slice(layer.dir.length + 1);
    }
    if (candidate === "") continue;
    const probe = isDir ? candidate + "/" : candidate;
    try {
      if (layer.ig.ignores(probe)) return true;
    } catch {
      // Paths ignore() refuses are never ignored.
    }
  }
  return false;
}
