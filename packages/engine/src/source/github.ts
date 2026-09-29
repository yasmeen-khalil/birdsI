import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { App } from "@octokit/app";
import type { Octokit } from "@octokit/rest";
import type { EngineConfig } from "../config";
import { snapshotFromTarball } from "./tarball";
import type { Snapshot } from "./types";

export interface RepoRef {
  owner: string;
  name: string;
  installationId: number;
}

/**
 * Everything birdsI does on GitHub goes through the GitHub App: reading a
 * repository, and opening a pull request with a fix. The app never pushes to
 * a branch the user did not create through birdsI.
 */
export class GitHubSource {
  private readonly app: App;

  constructor(config: EngineConfig) {
    if (!config.github.appId || !config.github.privateKey) {
      throw new Error("GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY must be set to read repositories.");
    }
    this.app = new App({ appId: config.github.appId, privateKey: config.github.privateKey });
  }

  static isConfigured(config: EngineConfig): boolean {
    return Boolean(config.github.appId && config.github.privateKey);
  }

  async installationClient(installationId: number): Promise<Octokit> {
    return (await this.app.getInstallationOctokit(installationId)) as unknown as Octokit;
  }

  /** The account an installation belongs to, verified against the App API. */
  async installationInfo(installationId: number): Promise<{ accountLogin: string; accountType: string; suspended: boolean }> {
    const { data } = await this.app.octokit.request("GET /app/installations/{installation_id}", { installation_id: installationId });
    const account = data.account as { login?: string; slug?: string; type?: string } | null;
    return { accountLogin: account?.login ?? account?.slug ?? "", accountType: account?.type ?? (account?.slug ? "Enterprise" : "User"), suspended: Boolean(data.suspended_at) };
  }

  /** Repositories the installation grants access to. */
  async listRepos(installationId: number): Promise<Array<{ id: number; fullName: string; defaultBranch: string; private: boolean }>> {
    const octokit = await this.installationClient(installationId);
    const repos: Array<{ id: number; fullName: string; defaultBranch: string; private: boolean }> = [];
    for await (const response of octokit.paginate.iterator(octokit.rest.apps.listReposAccessibleToInstallation, { per_page: 100 })) {
      for (const repo of response.data) {
        repos.push({ id: repo.id, fullName: repo.full_name, defaultBranch: repo.default_branch, private: repo.private });
      }
    }
    return repos;
  }

  async resolveHead(ref: RepoRef, branch: string): Promise<string> {
    const octokit = await this.installationClient(ref.installationId);
    const { data } = await octokit.rest.repos.getBranch({ owner: ref.owner, repo: ref.name, branch });
    return data.commit.sha;
  }

  /** Downloads the tree at a ref as a tarball and extracts it into a temp dir. */
  async snapshot(ref: RepoRef, branch: string): Promise<Snapshot> {
    const octokit = await this.installationClient(ref.installationId);
    const sha = await this.resolveHead(ref, branch);
    const response = await octokit.rest.repos.downloadTarballArchive({ owner: ref.owner, repo: ref.name, ref: sha, request: { parseSuccessResponseBody: false } });
    const dir = await mkdtemp(join(tmpdir(), "birdsi-dl-"));
    const tarPath = join(dir, "repo.tgz");
    const body = response.data as unknown;
    if (body instanceof ReadableStream) {
      await pipeline(Readable.fromWeb(body as import("node:stream/web").ReadableStream), createWriteStream(tarPath));
    } else if (body instanceof ArrayBuffer) {
      await pipeline(Readable.from(Buffer.from(body)), createWriteStream(tarPath));
    } else {
      throw new Error("Unexpected tarball response from GitHub");
    }
    const snap = await snapshotFromTarball(tarPath, { fullName: `${ref.owner}/${ref.name}`, branch, commitSha: sha });
    const innerCleanup = snap.cleanup;
    snap.cleanup = async () => {
      await innerCleanup();
      await rm(dir, { recursive: true, force: true });
    };
    return snap;
  }

  /**
   * Opens a pull request from a new branch holding the given file changes.
   * Files are committed through the Git Data API in a single commit so the
   * PR is one reviewable unit.
   */
  async openPullRequest(
    ref: RepoRef,
    input: {
      baseBranch: string;
      baseSha: string;
      branchName: string;
      title: string;
      body: string;
      commitMessage: string;
      files: Array<{ path: string; content: string | null }>;
    },
  ): Promise<{ number: number; url: string }> {
    const octokit = await this.installationClient(ref.installationId);
    const { owner, name: repo } = ref;

    const baseCommit = await octokit.rest.git.getCommit({ owner, repo, commit_sha: input.baseSha });
    const tree = await octokit.rest.git.createTree({
      owner,
      repo,
      base_tree: baseCommit.data.tree.sha,
      tree: input.files.map((file) =>
        file.content === null
          ? { path: file.path, mode: "100644" as const, type: "blob" as const, sha: null }
          : { path: file.path, mode: "100644" as const, type: "blob" as const, content: file.content },
      ),
    });
    const commit = await octokit.rest.git.createCommit({
      owner,
      repo,
      message: input.commitMessage,
      tree: tree.data.sha,
      parents: [input.baseSha],
    });
    await octokit.rest.git.createRef({ owner, repo, ref: `refs/heads/${input.branchName}`, sha: commit.data.sha });
    const pr = await octokit.rest.pulls.create({
      owner,
      repo,
      title: input.title,
      body: input.body,
      head: input.branchName,
      base: input.baseBranch,
      maintainer_can_modify: true,
    });
    return { number: pr.data.number, url: pr.data.html_url };
  }
}
