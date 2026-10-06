import { z } from "zod";
import { FindingDraft, AuditArea } from "./domain";

/**
 * Append-only progress events written by the scan runner and replayed by every
 * surface (web, CLI, MCP). A scan's event log is the source of truth for
 * what happened, in order.
 */

export const ScanStep = z.enum([
  "fetch",
  "inventory",
  "dependencies",
  "vendors",
  "secrets",
  "vulnerabilities",
  "docs",
  "review",
  "crosscheck",
  "audit",
  "rank",
]);
export type ScanStep = z.infer<typeof ScanStep>;

export const ScanEvent = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("scan_started"),
    kind: z.enum(["light", "deep", "audit"]),
    steps: z.array(ScanStep),
  }),
  z.object({
    type: z.literal("step_started"),
    step: ScanStep,
    /** Plain-language line shown next to the step. */
    label: z.string(),
    /** Expected units of work, when known (files, packages). */
    total: z.number().int().nonnegative().optional(),
  }),
  z.object({
    type: z.literal("step_progress"),
    step: ScanStep,
    done: z.number().int().nonnegative(),
    total: z.number().int().nonnegative().optional(),
  }),
  z.object({
    type: z.literal("file_reading"),
    step: ScanStep,
    path: z.string(),
    /** What is being checked in this file, in plain words. */
    checks: z.array(z.string()),
  }),
  z.object({
    type: z.literal("inventory"),
    filesSeen: z.number().int().nonnegative(),
    filesToRead: z.number().int().nonnegative(),
    languages: z.array(z.object({ name: z.string(), files: z.number().int().nonnegative() })),
    /** Folder map for the bird's-eye view: top folder and file count. */
    folders: z.array(
      z.object({
        name: z.string(),
        files: z.array(z.string()),
      }),
    ),
  }),
  z.object({
    type: z.literal("vendor"),
    slug: z.string(),
    name: z.string(),
    category: z.string(),
    detectedBy: z.array(z.string()),
  }),
  z.object({
    type: z.literal("finding"),
    finding: FindingDraft.extend({ id: z.string() }),
  }),
  z.object({
    type: z.literal("step_done"),
    step: ScanStep,
    findings: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("audit_area"),
    area: AuditArea,
    verdict: z.enum(["pass", "attention", "blocker"]),
    note: z.string(),
  }),
  z.object({
    /** What the review step read, with content hashes, so the next scan can skip unchanged files. */
    type: z.literal("review_index"),
    files: z.array(z.object({ path: z.string(), hash: z.string() })),
  }),
  z.object({
    type: z.literal("note"),
    /** A line worth showing: a skipped folder, a budget cap reached. */
    text: z.string(),
  }),
  z.object({
    type: z.literal("scan_done"),
    findings: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("scan_failed"),
    error: z.string(),
  }),
  z.object({
    type: z.literal("scan_stopped"),
  }),
]);
export type ScanEvent = z.infer<typeof ScanEvent>;

export const ScanEventRecord = z.object({
  seq: z.number().int().nonnegative(),
  at: z.string(),
  event: ScanEvent,
});
export type ScanEventRecord = z.infer<typeof ScanEventRecord>;
