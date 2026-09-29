// Points git at the repo's hooks so the secret check runs on every commit,
// and links the web app to the single .env.local at the repository root.
// Runs on `npm install`; safe to run again at any time.
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

if (existsSync(join(root, ".git"))) {
  try {
    execFileSync("git", ["config", "core.hooksPath", ".githooks"], { cwd: root, stdio: "ignore" });
    for (const hook of ["pre-commit", "commit-msg"]) {
      chmodSync(join(root, ".githooks", hook), 0o755);
    }
  } catch {
    // Git missing or the config is not writable; the hooks are optional locally.
  }
}

// Next.js only reads env files from its own folder. One file at the root
// serves both the web app and the worker.
const link = join(root, "apps", "web", ".env.local");
try {
  if (!existsSync(link) && !isSymlink(link)) {
    symlinkSync(join("..", "..", ".env.local"), link);
  }
} catch {
  // On platforms without symlink permission, copy .env.local into apps/web by hand.
}

function isSymlink(path) {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}
