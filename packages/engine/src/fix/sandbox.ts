import { createReadStream } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create as createTar } from "tar";
import type { EngineConfig } from "../config";
import type { Snapshot } from "../source/types";
import type { AppliedFile } from "./edits";

export interface SandboxRun {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  /** The command that ran, for the log shown to the user. */
  command: string;
  /** Sandboxes not configured, so the fix was not tested. */
  skipped: boolean;
}

interface OperationResponse {
  uuid: string;
  status: "PENDING" | "ASSIGNED" | "EXECUTING" | "SUCCESS" | "FAILED" | "CANCELLED";
  error?: string | null;
  duration?: number | null;
  result?: InstanceResult | null;
  metadata?: { result?: InstanceResult | null } | null;
}

interface InstanceResult {
  state?: { exit_code?: number; timed_out?: boolean };
  stdout?: { value: string; encoding: "ascii" | "base64"; truncated?: boolean };
  stderr?: { value: string; encoding: "ascii" | "base64"; truncated?: boolean };
}

/**
 * Tests a fix in a Token Factory Sandbox: uploads the repository snapshot
 * with the fix applied, runs the project's verify command in an isolated
 * VM, and reports the result. Nothing from the sandbox touches the user's
 * repository.
 */
export class SandboxRunner {
  constructor(private readonly config: EngineConfig) {}

  static isConfigured(config: EngineConfig): boolean {
    return config.tokenFactory.projectId !== null && config.tokenFactory.apiKey !== null;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.tokenFactory.apiKey}`,
      Project: this.config.tokenFactory.projectId ?? "",
      ...extra,
    };
  }

  private url(path: string): string {
    return `${this.config.tokenFactory.sandboxBaseUrl.replace(/\/$/, "")}${path}`;
  }

  async run(input: { snapshot: Snapshot; files: AppliedFile[]; command: string; ecosystemHint: "node" | "python" | "generic"; timeoutSeconds?: number }): Promise<SandboxRun> {
    const started = Date.now();
    if (!SandboxRunner.isConfigured(this.config)) {
      return { ok: false, exitCode: null, stdout: "", stderr: "", durationMs: 0, command: input.command, skipped: true };
    }
    const work = await mkdtemp(join(tmpdir(), "birdsi-sbx-"));
    try {
      // Build a tarball of the snapshot with the fix applied on top.
      const staged = join(work, "repo");
      await copyTree(input.snapshot.root, staged);
      for (const file of input.files) {
        const target = join(staged, file.path);
        if (file.content === null) await rm(target, { force: true });
        else {
          await (await import("node:fs/promises")).mkdir(join(target, ".."), { recursive: true });
          await writeFile(target, file.content, "utf8");
        }
      }
      const tarPath = join(work, "repo.tgz");
      await createTar({ gzip: true, file: tarPath, cwd: staged, portable: true, filter: (p) => !p.includes("node_modules/") && !p.includes("/.git/") }, ["."]);
      const uploaded = await this.uploadFile(tarPath);

      const image = this.imageFor(input.ecosystemHint);
      const install = input.ecosystemHint === "node" ? "if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi" : input.ecosystemHint === "python" ? "if [ -f requirements.txt ]; then pip install -q -r requirements.txt; fi" : "true";
      const script = `set -e\nmkdir -p /work && cd /work\ntar -xzf /mnt/repo.tgz -C /work\n${install}\n${input.command}`;
      const spawn = await fetch(this.url("/instances"), {
        method: "POST",
        headers: this.headers({ "content-type": "application/json" }),
        body: JSON.stringify({
          image,
          command: script,
          shell: true,
          disposable: true,
          timeout: input.timeoutSeconds ?? 600,
          truncate_output_at: 262_144,
          networking: { enabled: true },
          files: { "/mnt/repo.tgz": { uuid: uploaded.uuid, mode: "0644" } },
          env: { CI: "true", NODE_ENV: "test" },
        }),
      });
      if (!spawn.ok) throw new Error(`Sandbox could not start (HTTP ${spawn.status}): ${(await spawn.text()).slice(0, 300)}`);
      const location = spawn.headers.get("location");
      const body = (await spawn.json()) as { uuid?: string };
      const opId = location?.split("/").pop() ?? body.uuid;
      if (!opId) throw new Error("Sandbox returned no operation id");

      const op = await this.waitFor(opId, (input.timeoutSeconds ?? 600) + 120);
      const result = op.metadata?.result ?? op.result ?? null;
      const stdout = decode(result?.stdout);
      const stderr = decode(result?.stderr);
      const exitCode = result?.state?.exit_code ?? (op.status === "SUCCESS" ? 0 : null);
      const ok = op.status === "SUCCESS" && exitCode === 0 && !result?.state?.timed_out;
      return { ok, exitCode, stdout, stderr: op.error ? `${stderr}\n${op.error}`.trim() : stderr, durationMs: Date.now() - started, command: input.command, skipped: false };
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }

  private imageFor(hint: "node" | "python" | "generic"): string {
    const fromEnv = process.env[`BIRDSI_SANDBOX_IMAGE_${hint.toUpperCase()}`];
    if (fromEnv) return fromEnv;
    if (hint === "node") return "tag:node:22";
    if (hint === "python") return "tag:python:3.12";
    return "tag:ubuntu:latest";
  }

  private async uploadFile(path: string): Promise<{ uuid: string }> {
    const size = (await readFile(path)).byteLength;
    const response = await fetch(this.url("/files"), {
      method: "POST",
      headers: this.headers({ "content-type": "application/octet-stream", "content-length": String(size) }),
      body: createReadStream(path) as unknown as ReadableStream,
      // Node's fetch needs this to stream a request body.
      duplex: "half",
    } as RequestInit);
    if (!response.ok) throw new Error(`Sandbox upload failed (HTTP ${response.status}): ${(await response.text()).slice(0, 300)}`);
    return (await response.json()) as { uuid: string };
  }

  private async waitFor(opId: string, maxSeconds: number): Promise<OperationResponse> {
    const deadline = Date.now() + maxSeconds * 1000;
    let delay = 2000;
    while (Date.now() < deadline) {
      const response = await fetch(this.url(`/operations/${opId}`), { headers: this.headers() });
      if (!response.ok) throw new Error(`Sandbox status check failed (HTTP ${response.status})`);
      const op = (await response.json()) as OperationResponse;
      if (op.status === "SUCCESS" || op.status === "FAILED" || op.status === "CANCELLED") return op;
      const retryAfter = Number.parseInt(response.headers.get("retry-after") ?? "", 10);
      await new Promise((r) => setTimeout(r, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : delay));
      delay = Math.min(delay * 1.5, 10_000);
    }
    throw new Error("The sandbox run did not finish in time");
  }
}

function decode(stream: InstanceResult["stdout"]): string {
  if (!stream) return "";
  const text = stream.encoding === "base64" ? Buffer.from(stream.value, "base64").toString("utf8") : stream.value;
  return stream.truncated ? `${text}\n... (output truncated)` : text;
}

async function copyTree(from: string, to: string): Promise<void> {
  const fs = await import("node:fs/promises");
  await fs.cp(from, to, {
    recursive: true,
    filter: (src) => !/(^|\/)(node_modules|\.git|\.next|dist|build|coverage|__pycache__|\.venv)(\/|$)/.test(src.slice(from.length)),
  });
}

/** Picks the sandbox image family from the manifests at the repository root. */
export async function ecosystemHintFor(root: string): Promise<"node" | "python" | "generic"> {
  const { access } = await import("node:fs/promises");
  const exists = async (name: string) => {
    try {
      await access(join(root, name));
      return true;
    } catch {
      return false;
    }
  };
  if (await exists("package.json")) return "node";
  for (const name of ["requirements.txt", "pyproject.toml", "Pipfile"]) if (await exists(name)) return "python";
  return "generic";
}
