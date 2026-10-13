import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CliError } from "../exit";
import { allowedScanRoot } from "./scope";

let base: string;
let repo: string;

beforeAll(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), "birdsi-scope-")));
  repo = join(base, "repo");
  await mkdir(join(repo, ".git"), { recursive: true });
  await writeFile(join(repo, ".git", "HEAD"), "ref: refs/heads/main\n");
  await mkdir(join(repo, "apps", "web"), { recursive: true });
  await mkdir(join(base, "elsewhere"), { recursive: true });
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("allowedScanRoot", () => {
  it("allows the starting folder, folders inside it, and its git repository", async () => {
    const cwd = join(repo, "apps");
    expect(await allowedScanRoot(cwd, cwd, base)).toBe(cwd);
    expect(await allowedScanRoot("web", cwd, base)).toBe(join(repo, "apps", "web"));
    expect(await allowedScanRoot(repo, cwd, base)).toBe(repo);
  });

  it("refuses folders outside the project", async () => {
    await expect(allowedScanRoot(join(base, "elsewhere"), repo, base)).rejects.toBeInstanceOf(CliError);
    await expect(allowedScanRoot("/", repo, base)).rejects.toBeInstanceOf(CliError);
    await expect(allowedScanRoot(join(repo, ".."), repo, base)).rejects.toBeInstanceOf(CliError);
  });

  it("never treats the home folder as a project", async () => {
    await expect(allowedScanRoot(join(base, "elsewhere"), base, base)).rejects.toBeInstanceOf(CliError);
  });
});
