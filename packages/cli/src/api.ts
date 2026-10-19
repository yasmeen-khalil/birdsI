import {
  ActionRequest,
  ActionsResponse,
  ApiError,
  ChangesResponse,
  PolicyResponse,
  RecordEntryEnvelope,
  RecordResponse,
  type WriteRecordRequest,
  CreateScanResponse,
  InventoryResponse,
  Question,
  QuestionsResponse,
  VendorsResponse,
  VisionResponse,
  type ProjectHints,
  type RequestActionRequest,
  DeviceLoginPoll,
  DeviceLoginStart,
  FindingResponse,
  ReposResponse,
  ScanEventsResponse,
  ScanResponse,
  SnapshotUploadResponse,
  type CreateScanRequest,
} from "@birdsi/shared";
import { z } from "zod";
import { readConfig, notSignedIn, resolveApiUrl, resolveAuth, type ResolvedAuth, type StoredConfig } from "./config";
import { CliError, EXIT } from "./exit";
import { VERSION } from "./version";

/** The API answered with an error status. */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
  }
}

/** The API could not be reached, or answered with something that was not the expected shape. */
export class NetworkError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "NetworkError";
  }
}

/** A parsed response plus the exact JSON the server sent, for --json output. */
export interface Result<T> {
  data: T;
  raw: unknown;
}

const MeResponse = z.object({ userId: z.string(), login: z.string() });
export type MeResponse = z.infer<typeof MeResponse>;
const OkResponse = z.object({ ok: z.literal(true) });
const QuestionEnvelope = z.object({ question: Question });
const ActionEnvelope = z.object({ action: ActionRequest });

const DEFAULT_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 15 * 60_000;

interface RequestOptions<T> {
  schema: z.ZodType<T>;
  body?: unknown;
  auth?: boolean;
  timeoutMs?: number;
}

export class ApiClient {
  readonly baseUrl: string;
  readonly auth: ResolvedAuth | null;
  /** Who is calling: the terminal, or a coding agent through the MCP server. */
  client: "cli" | "mcp" = "cli";

  constructor(baseUrl: string, auth: ResolvedAuth | null) {
    this.baseUrl = baseUrl;
    this.auth = auth;
  }

  /** Client from the environment and the saved config. */
  static async fromEnvironment(env: NodeJS.ProcessEnv = process.env): Promise<{ api: ApiClient; config: StoredConfig }> {
    const config = await readConfig(env);
    return { api: new ApiClient(resolveApiUrl(config, env), resolveAuth(config, env)), config };
  }

  get signedIn(): boolean {
    return this.auth !== null;
  }

  /** Throws the not-signed-in error when there is no token. */
  requireAuth(): ResolvedAuth {
    if (!this.auth) throw notSignedIn();
    return this.auth;
  }

  async request<T>(method: string, path: string, options: RequestOptions<T>): Promise<Result<T>> {
    const needsAuth = options.auth ?? true;
    const headers: Record<string, string> = {
      accept: "application/json",
      "user-agent": `birdsi-${this.client}/${VERSION}`,
      "x-birdsi-client": this.client,
    };
    if (needsAuth) headers.authorization = `Bearer ${this.requireAuth().token}`;
    let body: string | undefined;
    if (options.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(options.body);
    }
    const url = `${this.baseUrl}/api/v1${path}`;
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        ...(body !== undefined ? { body } : {}),
        signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
    } catch (error) {
      throw new NetworkError(`birdsI could not be reached at ${this.baseUrl}.`, { cause: error });
    }
    const text = await response.text().catch(() => "");
    let json: unknown = undefined;
    if (text !== "") {
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
    }
    if (!response.ok) {
      const parsedError = ApiError.safeParse(json);
      if (parsedError.success) {
        throw new ApiRequestError(response.status, parsedError.data.error.code, parsedError.data.error.message);
      }
      throw new ApiRequestError(response.status, `http_${response.status}`, response.statusText || "Request failed");
    }
    const parsed = options.schema.safeParse(json);
    if (!parsed.success) {
      throw new NetworkError(
        `birdsI answered ${method} ${path} with something this version of the tool does not understand. Update with npm i -g birdsi@latest.`,
        { cause: parsed.error },
      );
    }
    return { data: parsed.data, raw: json };
  }

  // Sign-in

  deviceStart(): Promise<Result<DeviceLoginStart>> {
    return this.request("POST", "/device/start", { schema: DeviceLoginStart, auth: false, body: {} });
  }

  devicePoll(deviceCode: string): Promise<Result<DeviceLoginPoll>> {
    return this.request("POST", "/device/poll", { schema: DeviceLoginPoll, auth: false, body: { deviceCode } });
  }

  me(): Promise<Result<MeResponse>> {
    return this.request("GET", "/me", { schema: MeResponse });
  }

  // Repositories

  repos(): Promise<Result<ReposResponse>> {
    return this.request("GET", "/repos", { schema: ReposResponse });
  }

  latestScan(repoId: string): Promise<Result<ScanResponse>> {
    return this.request("GET", `/repos/${enc(repoId)}/latest`, { schema: ScanResponse });
  }

  // Snapshots

  createSnapshot(body: { fullName?: string; branch?: string; commitSha?: string }): Promise<Result<SnapshotUploadResponse>> {
    return this.request("POST", "/snapshots", { schema: SnapshotUploadResponse, body });
  }

  /** PUT to the signed upload URL. The bearer token is never sent there: the URL itself grants access. */
  async uploadSnapshot(uploadUrl: string, bytes: Uint8Array): Promise<void> {
    let response: Response;
    try {
      response = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "content-type": "application/gzip", "x-upsert": "false" },
        body: bytes,
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      });
    } catch (error) {
      throw new NetworkError("The upload of your files did not go through.", { cause: error });
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new ApiRequestError(response.status, "upload_failed", text.slice(0, 300) || response.statusText || "Upload failed");
    }
  }

  completeSnapshot(snapshotId: string, bytes: number, hints?: ProjectHints | null): Promise<Result<z.infer<typeof OkResponse>>> {
    return this.request("POST", `/snapshots/${enc(snapshotId)}/complete`, { schema: OkResponse, body: { bytes, ...(hints ? { hints } : {}) } });
  }

  // Vendors, questions, actions, vision: the operations record

  vendors(repoId: string): Promise<Result<VendorsResponse>> {
    return this.request("GET", `/repos/${enc(repoId)}/vendors`, { schema: VendorsResponse });
  }

  syncVendors(repoId: string): Promise<Result<z.infer<typeof OkResponse>>> {
    return this.request("POST", `/repos/${enc(repoId)}/vendors/sync`, { schema: OkResponse, body: {} });
  }

  inventory(repoId: string): Promise<Result<InventoryResponse>> {
    return this.request("GET", `/repos/${enc(repoId)}/inventory`, { schema: InventoryResponse });
  }

  questions(repoId: string, status?: "open" | "answered" | "dismissed"): Promise<Result<QuestionsResponse>> {
    return this.request("GET", `/repos/${enc(repoId)}/questions${status ? `?status=${status}` : ""}`, { schema: QuestionsResponse });
  }

  askOwner(repoId: string, body: { question: string; why: string; options?: string[]; vendorSlug?: string }): Promise<Result<z.infer<typeof QuestionEnvelope>>> {
    return this.request("POST", `/repos/${enc(repoId)}/questions`, { schema: QuestionEnvelope, body });
  }

  answerQuestion(questionId: string, answer: string): Promise<Result<z.infer<typeof QuestionEnvelope>>> {
    return this.request("POST", `/questions/${enc(questionId)}`, { schema: QuestionEnvelope, body: { answer } });
  }

  dismissQuestion(questionId: string): Promise<Result<z.infer<typeof OkResponse>>> {
    return this.request("POST", `/questions/${enc(questionId)}`, { schema: OkResponse, body: { dismiss: true } });
  }

  policy(repoId: string): Promise<Result<PolicyResponse>> {
    return this.request("GET", `/repos/${enc(repoId)}/policy`, { schema: PolicyResponse });
  }

  actions(repoId: string, status?: ActionRequest["status"]): Promise<Result<ActionsResponse>> {
    return this.request("GET", `/repos/${enc(repoId)}/actions${status ? `?status=${status}` : ""}`, { schema: ActionsResponse });
  }

  requestAction(repoId: string, body: RequestActionRequest): Promise<Result<z.infer<typeof ActionEnvelope>>> {
    return this.request("POST", `/repos/${enc(repoId)}/actions`, { schema: ActionEnvelope, body });
  }

  action(actionId: string): Promise<Result<z.infer<typeof ActionEnvelope>>> {
    return this.request("GET", `/actions/${enc(actionId)}`, { schema: ActionEnvelope });
  }

  reportAction(actionId: string, ok: boolean, output: string): Promise<Result<z.infer<typeof ActionEnvelope>>> {
    return this.request("POST", `/actions/${enc(actionId)}/report`, { schema: ActionEnvelope, body: { ok, output: output.slice(0, 20_000) } });
  }

  changes(repoId: string, since?: string): Promise<Result<ChangesResponse>> {
    return this.request("GET", `/repos/${enc(repoId)}/changes${since ? `?since=${enc(since)}` : ""}`, { schema: ChangesResponse });
  }

  vision(repoId: string): Promise<Result<VisionResponse>> {
    return this.request("GET", `/repos/${enc(repoId)}/vision`, { schema: VisionResponse });
  }

  setVision(repoId: string, text: string): Promise<Result<VisionResponse>> {
    return this.request("PUT", `/repos/${enc(repoId)}/vision`, { schema: VisionResponse, body: { text } });
  }

  // Scans

  createScan(body: CreateScanRequest): Promise<Result<CreateScanResponse>> {
    return this.request("POST", "/scans", { schema: CreateScanResponse, body });
  }

  scan(scanId: string): Promise<Result<ScanResponse>> {
    return this.request("GET", `/scans/${enc(scanId)}`, { schema: ScanResponse });
  }

  scanEvents(scanId: string, after: number): Promise<Result<ScanEventsResponse>> {
    return this.request("GET", `/scans/${enc(scanId)}/events?after=${after}`, { schema: ScanEventsResponse });
  }

  stopScan(scanId: string): Promise<Result<z.infer<typeof OkResponse>>> {
    return this.request("POST", `/scans/${enc(scanId)}/stop`, { schema: OkResponse, body: {} });
  }

  // Findings

  finding(findingId: string): Promise<Result<FindingResponse>> {
    return this.request("GET", `/findings/${enc(findingId)}`, { schema: FindingResponse });
  }

  dismiss(findingId: string): Promise<Result<z.infer<typeof OkResponse>>> {
    return this.request("POST", `/findings/${enc(findingId)}/dismiss`, { schema: OkResponse, body: {} });
  }

  markFixed(findingId: string, note?: string): Promise<Result<z.infer<typeof OkResponse>>> {
    return this.request("POST", `/findings/${enc(findingId)}/fixed`, { schema: OkResponse, body: note ? { note } : {} });
  }

  record(repoId: string, options: { kind?: string; limit?: number } = {}): Promise<Result<RecordResponse>> {
    const params = new URLSearchParams();
    if (options.kind) params.set("kind", options.kind);
    if (options.limit) params.set("limit", String(options.limit));
    const query = params.toString();
    return this.request("GET", `/repos/${enc(repoId)}/record${query ? `?${query}` : ""}`, { schema: RecordResponse });
  }

  writeRecord(repoId: string, body: WriteRecordRequest): Promise<Result<z.infer<typeof RecordEntryEnvelope>>> {
    return this.request("POST", `/repos/${enc(repoId)}/record`, { schema: RecordEntryEnvelope, body });
  }
}

function enc(id: string): string {
  return encodeURIComponent(id);
}

/** Errors worth retrying inside a polling loop: the network blinked, or the server was briefly unwell. */
export function isTransient(error: unknown): boolean {
  if (error instanceof NetworkError) return !(error.cause instanceof z.ZodError);
  if (error instanceof ApiRequestError) return error.status === 429 || error.status >= 500;
  return false;
}

/** Turns any error from the API layer into a CliError with plain words and the right exit code. */
export function toCliError(error: unknown, what?: string): CliError {
  if (error instanceof CliError) return error;
  if (error instanceof NetworkError) {
    return new CliError(error.message, EXIT.failed, "Check your internet connection, then try again.");
  }
  if (error instanceof ApiRequestError) {
    const detail = error.message && !/^http_/.test(error.code) ? error.message : undefined;
    switch (error.status) {
      case 401:
        return new CliError(
          "birdsI did not accept your sign-in. It may have expired or been revoked.",
          EXIT.notSignedIn,
          "Run birdsi login to sign in again.",
        );
      case 403:
        return new CliError(
          `Your account does not have access to ${what ?? "this"}.${detail ? ` ${sentence(detail)}` : ""}`,
          EXIT.failed,
        );
      case 404:
        return new CliError(`birdsI could not find ${what ?? "that"}.${detail ? ` ${sentence(detail)}` : ""}`, EXIT.failed, "Check the id and try again.");
      case 402:
        return new CliError(
          `birdsI did not start this because it would go over your budget.${detail ? ` ${sentence(detail)}` : ""}`,
          EXIT.failed,
          "See your usage in Settings on the birdsI website.",
        );
      case 429:
        return new CliError("birdsI is getting too many requests from you right now.", EXIT.failed, "Wait a minute, then try again.");
      case 413:
        return new CliError(`Your files are too large to send to birdsI.${detail ? ` ${sentence(detail)}` : ""}`, EXIT.failed);
      case 503:
        // A feature whose migration the operator has not run yet says so; nothing on the user's side is wrong.
        if (error.code === "not_ready") {
          return new CliError(detail ? sentence(detail) : "This birdsI is not set up for that yet.", EXIT.failed, "The operator of this birdsI has a database migration to run. Nothing on your side is wrong.");
        }
        return new CliError("birdsI is not available right now (HTTP 503).", EXIT.failed, "Try again in a few minutes. Nothing in your files changed.");
      default:
        if (error.status >= 500) {
          return new CliError(
            `birdsI had a problem on its side (HTTP ${error.status}).`,
            EXIT.failed,
            "Try again in a few minutes. Nothing in your files changed.",
          );
        }
        return new CliError(
          `birdsI did not accept the request (HTTP ${error.status}).${detail ? ` ${sentence(detail)}` : ""}`,
          EXIT.failed,
        );
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  return new CliError(`Something went wrong: ${message}`, EXIT.failed);
}

function sentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}
