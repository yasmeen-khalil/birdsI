import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanVersion, collectDependencies } from "./manifests";
import { walkInventory } from "./walk";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "birdsi-man-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function file(path: string, content: string): Promise<void> {
  await mkdir(join(root, path, ".."), { recursive: true });
  await writeFile(join(root, path), content);
}

describe("collectDependencies", () => {
  it("prefers lockfile versions over declared ranges for npm", async () => {
    await file("package.json", JSON.stringify({ dependencies: { next: "^14.1.0", local: "file:../x" }, devDependencies: { vitest: "~1.2.0" } }));
    await file("package-lock.json", JSON.stringify({ packages: { "node_modules/next": { version: "14.1.4" } } }));
    const deps = await collectDependencies(await walkInventory(root));
    const next = deps.find((d) => d.name === "next");
    expect(next?.version).toBe("14.1.4");
    expect(next?.ecosystem).toBe("npm");
    expect(deps.find((d) => d.name === "vitest")?.version).toBe("1.2.0");
    expect(deps.find((d) => d.name === "local")).toBeUndefined();
  });

  it("reads Python, Go, Rust and Ruby manifests", async () => {
    await file("requirements.txt", "django==4.2.1\nrequests>=2.31 # http\n-r other.txt\n");
    await file("go.mod", "module example.com/app\n\ngo 1.22\n\nrequire (\n\tgithub.com/gin-gonic/gin v1.9.1\n\tgolang.org/x/text v0.14.0 // indirect\n)\n");
    await file("Cargo.toml", "[package]\nname = \"app\"\n\n[dependencies]\nserde = \"1.0.196\"\ntokio = { version = \"1.36\", features = [\"full\"] }\n");
    await file("Gemfile", "source 'https://rubygems.org'\ngem 'rails', '~> 7.1'\ngem 'pg'\n");
    await file("Gemfile.lock", "GEM\n  specs:\n    rails (7.1.3)\n    pg (1.5.4)\n");
    const deps = await collectDependencies(await walkInventory(root));
    expect(deps.find((d) => d.name === "django")).toMatchObject({ ecosystem: "PyPI", version: "4.2.1" });
    expect(deps.find((d) => d.name === "requests")).toMatchObject({ ecosystem: "PyPI", version: "2.31" });
    expect(deps.find((d) => d.name === "github.com/gin-gonic/gin")).toMatchObject({ ecosystem: "Go", version: "1.9.1", direct: true });
    expect(deps.find((d) => d.name === "golang.org/x/text")).toMatchObject({ direct: false });
    expect(deps.find((d) => d.name === "serde")).toMatchObject({ ecosystem: "crates.io", version: "1.0.196" });
    expect(deps.find((d) => d.name === "tokio")).toMatchObject({ version: "1.36" });
    expect(deps.find((d) => d.name === "rails")).toMatchObject({ ecosystem: "RubyGems", version: "7.1.3" });
    expect(deps.find((d) => d.name === "pg")).toMatchObject({ version: "1.5.4" });
  });
});

describe("cleanVersion", () => {
  it("strips range operators", () => {
    expect(cleanVersion("^1.2.3")).toBe("1.2.3");
    expect(cleanVersion(">=2.0,<3")).toBe("2.0");
    expect(cleanVersion("~1.2.3-beta.1")).toBe("1.2.3-beta.1");
  });
});
