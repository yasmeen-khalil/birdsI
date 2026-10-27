import { z } from "zod";
import { FindingDraft } from "./domain";

/**
 * Append-only progress events written by the scan runner and replayed by every
 * surface (web, CLI, MCP). A scan's event log is the source of truth for
 * what happened, in order.
 */

/** "review", "crosscheck" and "audit" only appear in event logs written before v3. */
export const ScanStep = z.enum([
  "fetch",
  "inventory",
  "dependencies",
  "vendors",
  "map",
  "gaps",
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
    /** Folders and their files, top level first. */
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
    /** The service map's totals. The map itself is stored with the app, not in the event log. */
    type: z.literal("service_map"),
    services: z.number().int().nonnegative(),
    envNames: z.number().int().nonnegative(),
    crons: z.number().int().nonnegative(),
    webhooks: z.number().int().nonnegative(),
    storeApps: z.number().int().nonnegative(),
    migrations: z.number().int().nonnegative(),
    roles: z.array(z.string()),
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
    /** Written by the pre-launch audit before v3. */
    type: z.literal("audit_area"),
    area: z.string(),
    verdict: z.enum(["pass", "attention", "blocker"]),
    note: z.string(),
  }),
  z.object({
    /** What the model review read before v3, with content hashes. */
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
