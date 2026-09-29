import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

/** Paths a unified diff touches, in order, without the a/ b/ prefixes. */
export function patchedFiles(patch: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (p: string | undefined): void => {
    if (!p || p === "/dev/null" || seen.has(p)) return;
    seen.add(p);
    out.push(p);
  };
  let pendingOld: string | undefined;
  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith("--- ")) {
      pendingOld = stripPrefix(line.slice(4));
    } else if (line.startsWith("+++ ")) {
      const next = stripPrefix(line.slice(4));
      add(next === "/dev/null" ? pendingOld : next);
      pendingOld = undefined;
    }
  }
  return out;
}

function stripPrefix(raw: string): string {
  const path = raw.split("\t")[0]?.trim() ?? "";
  if (path === "/dev/null") return path;
  return path.replace(/^"(.*)"$/, "$1").replace(/^[ab]\//, "");
}

/** Patches produced against the tarball layout carry the snapshot/ folder; git apply then needs -p2. */
export function stripLevel(patch: string): number {
  const files = patchedFiles(patch);
  return files.length > 0 && files.every((f) => f.startsWith("snapshot/")) ? 2 : 1;
}

export type ApplyOutcome =
  | { applied: true; files: string[]; method: "3way" | "plain" }
  | { applied: false; files: string[]; patchFile: string; reason: string };

function runGit(cwd: string, args: string[], input: string): Promise<{ ok: boolean; stderr: string; missing: boolean }> {
  return new Promise((resolvePromise) => {
    let child;
    try {
      child = spawn("git", args, { cwd, stdio: ["pipe", "ignore", "pipe"] });
    } catch {
      return resolvePromise({ ok: false, stderr: "", missing: true });
    }
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", (error: NodeJS.ErrnoException) =>
      resolvePromise({ ok: false, stderr: error.message, missing: error.code === "ENOENT" }),
    );
    child.on("close", (code) => resolvePromise({ ok: code === 0, stderr: stderr.trim(), missing: false }));
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(input);
  });
}

/**
 * Applies a patch to a local folder: git apply --3way first (merges around
 * local edits), then a plain git apply for folders that are not git
 * repositories. If both fail, the patch is saved next to the code with the
 * command to apply it by hand.
 */
export async function applyPatchLocally(dir: string, patch: string, fixId: string): Promise<ApplyOutcome> {
  const cwd = resolve(dir);
  const files = patchedFiles(patch).map((f) => (stripLevel(patch) === 2 ? f.replace(/^snapshot\//, "") : f));
  const p = `-p${stripLevel(patch)}`;
  const body = patch.endsWith("\n") ? patch : `${patch}\n`;

  const threeWay = await runGit(cwd, ["apply", "--3way", p, "-"], body);
  if (threeWay.ok) return { applied: true, files, method: "3way" };
  let reason = threeWay.missing ? "git is not installed" : threeWay.stderr;
  if (!threeWay.missing) {
    const plain = await runGit(cwd, ["apply", p, "-"], body);
    if (plain.ok) return { applied: true, files, method: "plain" };
    reason = plain.stderr || reason;
  }
  const patchFile = join(cwd, `birdsi-fix-${fixId.replace(/[^\w.-]/g, "_")}.patch`);
  await writeFile(patchFile, body, "utf8");
  return { applied: false, files, patchFile, reason: reason.split(/\r?\n/)[0] ?? "" };
}

/** The exact command to apply a saved patch file. */
export function manualApplyCommand(patchFile: string, patch: string): string {
  const level = stripLevel(patch);
  return `git apply --3way${level === 2 ? " -p2" : ""} "${patchFile}"`;
}
