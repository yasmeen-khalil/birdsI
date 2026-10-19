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
 * Everything birdsI does on GitHub goes through the GitHub App, and since v3
 * it only reads: the repository list and a tarball of a branch head. The App
 * needs Contents read and Metadata read, nothing that writes.
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
}
