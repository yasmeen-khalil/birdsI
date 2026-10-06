import type { Dependency, FindingDraft, OpsSummary, ScanKind, ScanStep } from "@birdsi/shared";
import type { EngineConfig, ScanBudget } from "../config";
import type { Inventory, InventoryFile } from "../inventory/walk";
import type { RawDependency } from "../inventory/manifests";
import type { ModelClient } from "../models/client";
import type { RepoDigest } from "../scan/digest";
import type { Snapshot } from "../source/types";

export interface PreviousReview {
  /** path -> content hash as recorded by the last scan's review step. */
  hashes: Map<string, string>;
  /** path -> the review findings that scan produced for the file. */
  findingsByPath: Map<string, FindingDraft[]>;
}

export interface CheckContext {
  config: EngineConfig;
  kind: ScanKind;
  budget: ScanBudget;
  snapshot: Snapshot;
  inventory: Inventory;
  /** Raw dependencies from manifests; enriched dependencies are filled by the dependency checks. */
  rawDependencies: RawDependency[];
  dependencies: Dependency[];
  /** Files chosen for model reading, in priority order and within budget. */
  filesToRead: InventoryFile[];
  /** Compact repository description placed at the top of every model prompt. */
  digest: RepoDigest;
  models: ModelClient;
  /** Reads a file from the snapshot, windowed to the tier's byte cap. */
  read: (path: string) => Promise<string>;
  /** Content hash of the whole file, for skipping unchanged files on later scans. */
  fileHash: (path: string) => Promise<string>;
  /** What the last finished scan read and found per file, when the repository has one. */
  previousReview: PreviousReview | null;
  emit: (event: import("@birdsi/shared").ScanEvent) => Promise<void>;
  note: (text: string) => Promise<void>;
  signal: AbortSignal;
  /** Free text from the user describing the app; sharpens the audit. */
  appDescription: string | null;
  /** Findings produced so far, for checks that build on earlier ones. */
  findingsSoFar: FindingDraft[];
  /** What is known about the app's services and limits from earlier syncs; null before the first. */
  ops: OpsSummary | null;
}

/**
 * A check is one source of findings. Checks are independent modules with a
 * stable id, so new ones (per language, per framework, per ecosystem) plug
 * in by being added to the registry.
 */
export interface Check {
  id: string;
  step: ScanStep;
  /** Plain-language label for the progress view. */
  label: string;
  /** Which tiers run this check. */
  tiers: ReadonlyArray<ScanKind>;
  /** True when the check can run with the current configuration (keys present). */
  available: (config: EngineConfig) => boolean;
  run: (ctx: CheckContext) => Promise<FindingDraft[]>;
}
