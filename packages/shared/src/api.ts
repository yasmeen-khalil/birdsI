import { z } from "zod";
import {
  Dependency,
  Finding,
  Fix,
  Repo,
  Scan,
  ScanKind,
} from "./domain";
import { ScanEventRecord } from "./events";
import { ProjectHints } from "./ops";

/**
 * Request and response shapes for the public API (/api/v1) used by the CLI
 * and the MCP server. The web app calls the same handlers.
 */

export const ApiError = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

export const CreateScanRequest = z.object({
  kind: ScanKind,
  /** Either a connected repo, or an uploaded snapshot from the CLI. */
  repoId: z.string().optional(),
  snapshotId: z.string().optional(),
  branch: z.string().optional(),
  /** Optional description of what the app does; sharpens the audit. */
  appDescription: z.string().max(2000).optional(),
  /** Sent by the bare command's --full. The kind decides what runs, so a full scan is a deep scan. */
  full: z.boolean().optional(),
});
export type CreateScanRequest = z.infer<typeof CreateScanRequest>;

export const CreateScanResponse = z.object({ scan: Scan, dashboardUrl: z.string().optional() });
export type CreateScanResponse = z.infer<typeof CreateScanResponse>;

export const ScanResponse = z.object({
  scan: Scan,
  findings: z.array(Finding),
  dependencies: z.array(Dependency),
});
export type ScanResponse = z.infer<typeof ScanResponse>;

export const ScanEventsResponse = z.object({
  events: z.array(ScanEventRecord),
  /** Pass back as `after` to fetch only newer events. */
  cursor: z.number().int().nonnegative(),
  status: Scan.shape.status,
  /** When a worker last reported in, while the scan is queued; null when unknown. */
  workerSeenAt: z.string().nullable().optional(),
});
export type ScanEventsResponse = z.infer<typeof ScanEventsResponse>;

export const ReposResponse = z.object({ repos: z.array(Repo) });
export type ReposResponse = z.infer<typeof ReposResponse>;

export const FindingResponse = z.object({ finding: Finding, fix: Fix.nullable() });
export type FindingResponse = z.infer<typeof FindingResponse>;

export const StartFixResponse = z.object({ fix: Fix });
export type StartFixResponse = z.infer<typeof StartFixResponse>;

export const CompleteSnapshotRequest = z.object({
  bytes: z.number().int().nonnegative().nullable().optional(),
  hints: ProjectHints.optional(),
});
export type CompleteSnapshotRequest = z.infer<typeof CompleteSnapshotRequest>;

export const SnapshotUploadResponse = z.object({
  snapshotId: z.string(),
  uploadUrl: z.url(),
  /** Bytes the upload may not exceed. */
  maxBytes: z.number().int().positive(),
});
export type SnapshotUploadResponse = z.infer<typeof SnapshotUploadResponse>;

export const DeviceLoginStart = z.object({
  deviceCode: z.string(),
  userCode: z.string(),
  verificationUrl: z.url(),
  expiresIn: z.number().int().positive(),
  interval: z.number().int().positive(),
});
export type DeviceLoginStart = z.infer<typeof DeviceLoginStart>;

export const DeviceLoginPoll = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending") }),
  z.object({ status: z.literal("expired") }),
  z.object({ status: z.literal("denied") }),
  z.object({
    status: z.literal("approved"),
    token: z.string(),
    login: z.string(),
  }),
]);
export type DeviceLoginPoll = z.infer<typeof DeviceLoginPoll>;

export const ChatMessage = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  citations: z
    .array(
      z.object({
        path: z.string().optional(),
        lineStart: z.number().int().optional(),
        findingId: z.string().optional(),
        label: z.string(),
      }),
    )
    .default([]),
  /** True when the reply rests on model reading with no finding behind it. */
  judgment: z.boolean().default(false),
  createdAt: z.string(),
});
export type ChatMessage = z.infer<typeof ChatMessage>;
