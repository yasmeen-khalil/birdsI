import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { list as listTar } from "tar";
import { buildSnapshot, walkSnapshot } from "./snapshot";
import { CliError } from "./exit";

let root: string;

async function put(path: string, content = "x"): Promise<void> {
  const full = join(root, path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, content);
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "birdsi-snap-"));
  await put(".gitignore", "*.log\n/secret-root.txt\ntmp/\n");
  await put("README.md");
  await put("secret-root.txt");
  await put("debug.log");
  await put("src/index.ts");
  await put("src/secret-root.txt"); // anchored rule only matches at the root
  await put("src/.gitignore", "generated/\n*.snap\n!keep.log\n");
  await put("src/generated/out.ts");
  await put("src/a.snap");
  await put("src/keep.log"); // re-included by the nested .gitignore
  await put("src/other.log");
  await put("tmp/cache.txt");
  await put("node_modules/pkg/index.js");
  await put("packages/web/node_modules/x/index.js");
  await put("packages/web/dist/app.js");
  await put("packages/web/package.json");
  await put("package-lock.json", "{}");
  await put("logo.png");
  await put(".git/HEAD", "ref: refs/heads/main\n");
  await put(".env", "A=1");
  await symlink(join(root, "README.md"), join(root, "link.md"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("walkSnapshot", () => {
  it("honours .gitignore at every level plus the built-in list, and skips symlinks", async () => {
    const walk = await walkSnapshot(root);
    expect(walk.files).toEqual(
      [
        ".gitignore",
        "README.md",
        "package-lock.json",
        "packages/web/package.json",
        "src/.gitignore",
        "src/index.ts",
        "src/keep.log",
        "src/secret-root.txt",
      ].sort(),
    );
    expect(walk.files).not.toContain("link.md");
    expect(walk.skipped).toBeGreaterThan(0);
  });

  it("stops with a clear message over the file cap", async () => {
    await expect(walkSnapshot(root, { limits: { maxFiles: 3 } })).rejects.toBeInstanceOf(CliError);
    await expect(walkSnapshot(root, { limits: { maxFiles: 3 } })).rejects.toThrow(/more than 3 files/);
  });

  it("stops with a clear message over the size cap", async () => {
    await expect(walkSnapshot(root, { limits: { maxTotalBytes: 4 } })).rejects.toThrow(/more than 4 bytes/);
  });

  it("leaves out single files over the per-file cap and says which", async () => {
    await put("big.txt", "y".repeat(64));
    try {
      const walk = await walkSnapshot(root, { limits: { maxFileBytes: 32 } });
      expect(walk.files).not.toContain("big.txt");
      expect(walk.tooLarge).toContain("big.txt");
    } finally {
      await rm(join(root, "big.txt"));
    }
  });

  it("refuses a path that is not a folder", async () => {
    await expect(walkSnapshot(join(root, "README.md"))).rejects.toThrow(/is a file/);
  });
});

describe("walkSnapshot credential files", () => {
  it("never sends credential files, even when a .gitignore re-includes them", async () => {
    const dir = await mkdtemp(join(tmpdir(), "birdsi-deny-"));
    const files: Record<string, string> = {
      ".gitignore": "!.env\n!.env.local\n!.envrc\n!*.pem\n!.dev.vars\n!.kube/\n",
      ".env": "A=1",
      ".env.local": "A=1",
      ".env.example": "A=",
      ".envrc": "export A=1",
      ".dev.vars": "A=1",
      "server.pem": "x",
      "AuthKey_ABC.p8": "x",
      ".git-credentials": "x",
      "prod.tfvars": "x",
      "infra/terraform.tfstate": "x",
      "infra/terraform.tfstate.backup": "x",
      ".pypirc": "x",
      ".docker/config.json": "{}",
      ".kube/config": "x",
      ".config/gh/hosts.yml": "x",
      ".config/birdsi/config.json": "{}",
      ".zsh_history": "x",
      "application_default_credentials.json": "{}",
      ".streamlit/secrets.toml": "x",
      "src/app.ts": "export {};",
      "src/config.json": "{}",
    };
    try {
      for (const [path, content] of Object.entries(files)) {
        await mkdir(dirname(join(dir, path)), { recursive: true });
        await writeFile(join(dir, path), content);
      }
      const walk = await walkSnapshot(dir);
      expect(walk.files).toEqual([".env.example", ".gitignore", "src/app.ts", "src/config.json"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("buildSnapshot", () => {
  it("wraps every entry under snapshot/ and only includes walked files", async () => {
    const snapshot = await buildSnapshot(root);
    try {
      const entries: string[] = [];
      await listTar({ file: snapshot.file, onReadEntry: (e) => entries.push(e.path) });
      expect(entries.length).toBe(snapshot.walk.files.length);
      expect(entries.every((p) => p.startsWith("snapshot/"))).toBe(true);
      expect(entries).toContain("snapshot/src/index.ts");
      expect(entries).not.toContain("snapshot/link.md");
      expect(snapshot.bytes).toBeGreaterThan(0);
    } finally {
      await snapshot.cleanup();
    }
  });
});
