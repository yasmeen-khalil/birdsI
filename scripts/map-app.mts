/**
 * Maps one app's code on this computer, the way the worker maps an upload,
 * and prints the service map as JSON (or writes it to a file). Nothing leaves
 * the computer and no model is called.
 *
 *   npx tsx scripts/map-app.mts <app folder> [out.json] [--worktree]
 *
 * In a git repository it maps the last commit (HEAD), so the map matches the
 * commit it records; --worktree maps the folder as it is, uncommitted files
 * included, the way `birdsi map` uploads it.
 */
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildServiceMap } from "../packages/engine/src/map/index";
import { collectDependencies } from "../packages/engine/src/inventory/manifests";
import { walkInventory } from "../packages/engine/src/inventory/walk";
import { discoverVendors } from "../packages/engine/src/vendors/discover";

const args = process.argv.slice(2);
const worktree = args.includes("--worktree");
const [folder, out] = args.filter((a) => !a.startsWith("--"));
if (!folder) {
  process.stderr.write("Usage: npx tsx scripts/map-app.mts <app folder> [out.json] [--worktree]\n");
  process.exit(5);
}
const source = resolve(folder);
const git = (gitArgs: string[]) => {
  try {
    return execFileSync("git", gitArgs, { cwd: source, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
};
const commit = git(["rev-parse", "HEAD"]);
const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);

let root = source;
let extracted: string | null = null;
if (commit && !worktree) {
  extracted = await mkdtemp(join(tmpdir(), "birdsi-map-"));
  const tar = execFileSync("git", ["archive", "--format=tar", "HEAD"], { cwd: source, maxBuffer: 2 ** 31 - 1 });
  execFileSync("tar", ["-x", "-C", extracted], { input: tar });
  root = extracted;
}

try {
  const walked = await walkInventory(root);
  // Env files never enter the map, whatever .gitignore says: only example files are read, for names.
  const inventory = { ...walked, files: walked.files.filter((f) => !/(^|\/)\.env(\.[^/]*)?$/.test(f.path) || /\.(example|sample|template)$/.test(f.path)) };
  const deps = await collectDependencies(inventory);
  const vendors = await discoverVendors(inventory, deps, null);
  const map = await buildServiceMap(inventory, deps, vendors, { commit: worktree ? null : commit, branch });
  const json = JSON.stringify(map, null, 2);
  if (out) await writeFile(out, json + "\n");
  else process.stdout.write(json + "\n");
} finally {
  if (extracted) await rm(extracted, { recursive: true, force: true });
}
