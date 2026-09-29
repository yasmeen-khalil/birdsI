import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { walkInventory } from "./walk";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "birdsi-walk-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function file(path: string, content = "x"): Promise<void> {
  await mkdir(join(root, path, ".."), { recursive: true });
  await writeFile(join(root, path), content);
}

describe("walkInventory", () => {
  it("skips built-in folders, lockfiles and binaries", async () => {
    await file("src/index.ts");
    await file("node_modules/pkg/index.js");
    await file("dist/bundle.js");
    await file("package-lock.json", "{}");
    await file("logo.png");
    const inv = await walkInventory(root);
    expect(inv.files.map((f) => f.path)).toEqual(["src/index.ts"]);
    expect(inv.skipped).toBeGreaterThan(0);
  });

  it("honours nested .gitignore files relative to their own folder", async () => {
    await file(".gitignore", "secret.txt\n");
    await file("secret.txt");
    await file("app/secret.txt");
    await file("app/.gitignore", "generated/\n");
    await file("app/generated/out.ts");
    await file("app/real.ts");
    await file("other/generated/keep.ts");
    const inv = await walkInventory(root);
    const paths = inv.files.map((f) => f.path);
    expect(paths).toContain("app/real.ts");
    expect(paths).toContain("other/generated/keep.ts");
    expect(paths).not.toContain("secret.txt");
    expect(paths).not.toContain("app/secret.txt");
    expect(paths).not.toContain("app/generated/out.ts");
  });

  it("labels languages and groups folders", async () => {
    await file("app/page.tsx");
    await file("app/api/route.ts");
    await file("main.py");
    await file("README.md");
    const inv = await walkInventory(root);
    expect(inv.languages.find((l) => l.name === "TypeScript")?.files).toBe(2);
    expect(inv.languages.find((l) => l.name === "Python")?.files).toBe(1);
    expect(inv.folders.find((f) => f.name === "app")?.files).toHaveLength(2);
    expect(inv.folders.find((f) => f.name === ".")?.files.sort()).toEqual(["README.md", "main.py"]);
  });
});
