/**
 * Maps one app's code on this computer, the way the worker maps an upload,
 * and prints the service map as JSON (or writes it to a file). The rules read
 * the code first. Then, when a model key is set in .env.local, the model reads
 * the code for what the rules missed, each find confirmed at its line, and an
 * existing output file serves as the previous map so unchanged files are not
 * read again. --no-model keeps it to the rules.
 *
 *   npx tsx scripts/map-app.mts <app folder> [out.json] [--worktree] [--no-model]
 *
 * In a git repository it maps the last commit (HEAD), so the map matches the
 * commit it records; --worktree maps the folder as it is, uncommitted files
 * included, the way `birdsi map` uploads it.
 */
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadEngineConfig } from "../packages/engine/src/config";
import { collectDependencies } from "../packages/engine/src/inventory/manifests";
import { walkInventory } from "../packages/engine/src/inventory/walk";
import { buildServiceMapWithContext } from "../packages/engine/src/map/index";
import { ModelClient } from "../packages/engine/src/models/client";
import { readerNote, readWithModel } from "../packages/engine/src/reader/index";
import { discoverVendors } from "../packages/engine/src/vendors/discover";
import { ServiceMap } from "../packages/shared/src/map";

// The model keys live in .env.local at the repository root, never in the shell's history.
try {
  process.loadEnvFile(resolve(import.meta.dirname, "../.env.local"));
} catch {
  // No .env.local: the rules alone read the code.
}

const args = process.argv.slice(2);
const worktree = args.includes("--worktree");
const noModel = args.includes("--no-model");
const [folder, out] = args.filter((a) => !a.startsWith("--"));
if (!folder) {
  process.stderr.write("Usage: npx tsx scripts/map-app.mts <app folder> [out.json] [--worktree] [--no-model]\n");
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
  const built = await buildServiceMapWithContext(inventory, deps, vendors, { commit: worktree ? null : commit, branch });
  let map = built.map;
  if (!noModel) {
    const config = loadEngineConfig();
    const models = new ModelClient(config, { maxInputTokens: config.budget.maxReadTokens });
    if (!models.available) {
      process.stderr.write("No model key is set (NEBIUS_API_KEY or ANTHROPIC_API_KEY in .env.local): the map is what the rules read.\n");
    } else {
      let previous: ServiceMap | null = null;
      if (out) {
        try {
          previous = ServiceMap.parse(JSON.parse(await readFile(out, "utf8")));
        } catch {
          previous = null;
        }
      }
      const read = await readWithModel({
        inventory,
        map,
        context: built.context,
        models,
        previous,
        maxInputTokens: config.budget.maxReadTokens,
        concurrency: config.budget.readConcurrency,
        emit: async (event) => {
          if (event.type === "step_progress") process.stderr.write(`reading pass ${event.done} of ${event.total ?? "?"}\n`);
          if (event.type === "note") process.stderr.write(`${event.text}\n`);
        },
        signal: new AbortController().signal,
      });
      map = read.map;
      process.stderr.write(`${readerNote(read.stats)}\n`);
    }
  }
  const json = JSON.stringify(map, null, 2);
  if (out) await writeFile(out, json + "\n");
  else process.stdout.write(json + "\n");
} finally {
  if (extracted) await rm(extracted, { recursive: true, force: true });
}
