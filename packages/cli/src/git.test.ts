import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parseGitConfigRemote, parseRemoteUrl, readGitInfo } from "./git";

describe("parseRemoteUrl", () => {
  it.each([
    ["https://github.com/acme/studio-bookings.git", "github.com", "acme/studio-bookings"],
    ["https://github.com/acme/studio-bookings", "github.com", "acme/studio-bookings"],
    ["https://github.com/acme/studio-bookings/", "github.com", "acme/studio-bookings"],
    ["http://github.com/acme/app.js.git", "github.com", "acme/app.js"],
    ["https://user:secret@github.com/acme/app.git", "github.com", "acme/app"],
    ["git@github.com:acme/studio-bookings.git", "github.com", "acme/studio-bookings"],
    ["git@github.com:acme/studio-bookings", "github.com", "acme/studio-bookings"],
    ["github.com:acme/app.git", "github.com", "acme/app"],
    ["ssh://git@github.com/acme/app.git", "github.com", "acme/app"],
    ["ssh://git@github.com:22/acme/app.git", "github.com", "acme/app"],
    ["git://github.com/acme/app.git", "github.com", "acme/app"],
    ["https://GitHub.com/Acme/App.git", "github.com", "Acme/App"],
    ["https://gitlab.com/group/sub/app.git", "gitlab.com", "sub/app"],
  ])("%s", (url, host, fullName) => {
    const parsed = parseRemoteUrl(url);
    expect(parsed?.host).toBe(host);
    expect(parsed?.fullName).toBe(fullName);
  });

  it.each(["", "not a url", "https://github.com/", "https://github.com/only-owner", "/local/path/repo.git", "file:///tmp/repo.git"])(
    "rejects %j",
    (url) => {
      expect(parseRemoteUrl(url)).toBeNull();
    },
  );
});

describe("parseGitConfigRemote", () => {
  it("reads the origin url and ignores other remotes", () => {
    const config = [
      "[core]",
      "\trepositoryformatversion = 0",
      '[remote "upstream"]',
      "\turl = https://github.com/other/app.git",
      '[remote "origin"]',
      "\turl = git@github.com:acme/app.git",
      "\tfetch = +refs/heads/*:refs/remotes/origin/*",
      '[branch "main"]',
      "\tremote = origin",
    ].join("\n");
    expect(parseGitConfigRemote(config, "origin")).toBe("git@github.com:acme/app.git");
    expect(parseGitConfigRemote(config, "missing")).toBeNull();
  });
});

describe("readGitInfo", () => {
  const dirs: string[] = [];
  afterAll(async () => {
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  });

  async function fakeRepo(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "birdsi-git-"));
    dirs.push(root);
    await mkdir(join(root, ".git", "refs", "heads"), { recursive: true });
    await writeFile(join(root, ".git", "config"), '[remote "origin"]\n\turl = https://github.com/acme/app.git\n');
    return root;
  }

  it("reads branch and sha from a loose ref, from a subfolder", async () => {
    const root = await fakeRepo();
    const sha = "a3f9c21".padEnd(40, "0");
    await writeFile(join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
    await writeFile(join(root, ".git", "refs", "heads", "main"), sha + "\n");
    await mkdir(join(root, "src"));
    const info = await readGitInfo(join(root, "src"));
    expect(info).toMatchObject({ root, branch: "main", commitSha: sha, remote: { fullName: "acme/app" } });
  });

  it("reads the sha from packed-refs", async () => {
    const root = await fakeRepo();
    const sha = "b".repeat(40);
    await writeFile(join(root, ".git", "HEAD"), "ref: refs/heads/feature/x\n");
    await writeFile(join(root, ".git", "packed-refs"), `# pack-refs with: peeled fully-peeled sorted\n${sha} refs/heads/feature/x\n`);
    const info = await readGitInfo(root);
    expect(info?.branch).toBe("feature/x");
    expect(info?.commitSha).toBe(sha);
  });

  it("handles a detached HEAD", async () => {
    const root = await fakeRepo();
    const sha = "c".repeat(40);
    await writeFile(join(root, ".git", "HEAD"), sha + "\n");
    const info = await readGitInfo(root);
    expect(info?.branch).toBeNull();
    expect(info?.commitSha).toBe(sha);
  });
});
