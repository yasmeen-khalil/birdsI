import type { Dependency, FindingDraft, ScanEvent, ScanStep } from "@birdsi/shared";
import type { EngineConfig, ScanBudget } from "../config";
import type { Inventory, InventoryFile } from "../inventory/walk";
import type { RawDependency } from "../inventory/manifests";
import type { ModelClient } from "../models/client";
import type { Snapshot } from "../source/types";

export interface CheckContext {
  config: EngineConfig;
  budget: ScanBudget;
  snapshot: Snapshot;
  inventory: Inventory;
  /** Raw dependencies from manifests; enriched dependencies are filled by the dependency checks. */
  rawDependencies: RawDependency[];
  dependencies: Dependency[];
  /** Code files in priority order, within budget, searched when a check needs to see how the code uses a package. */
  filesToRead: InventoryFile[];
  models: ModelClient;
  /** Reads a file from the snapshot, windowed to the budget's byte cap. */
  read: (path: string) => Promise<string>;
  emit: (event: ScanEvent) => Promise<void>;
  note: (text: string) => Promise<void>;
  signal: AbortSignal;
  /** Findings produced so far, for checks that build on earlier ones. */
  findingsSoFar: FindingDraft[];
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
  /** True when the check can run with the current configuration (keys present). */
  available: (config: EngineConfig) => boolean;
  run: (ctx: CheckContext) => Promise<FindingDraft[]>;
}
