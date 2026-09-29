import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AuditReport, Dependency, FindingDraft, ScanEvent, ScanKind, ScanStats, ScanStep, ScanSummary } from "@birdsi/shared";
import { runAudit } from "../checks/audit";
import { checksFor } from "../checks/registry";
import type { Check, CheckContext } from "../checks/types";
import { toDependency } from "../checks/vulnerabilities";
import type { EngineConfig } from "../config";
import { collectDependencies } from "../inventory/manifests";
import { prioritise } from "../inventory/priority";
import { walkInventory, type Inventory } from "../inventory/walk";
import { ModelClient, type Usage } from "../models/client";
import type { Snapshot } from "../source/types";
import { buildDigest } from "./digest";
import { rankFindings, summarise } from "./rank";

export interface ScanInput {
  kind: ScanKind;
  /** The code, or a function that fetches it; the fetch is then a visible step. */
  snapshot: Snapshot | (() => Promise<Snapshot>);
  appDescription?: string | null;
  signal?: AbortSignal;
  onEvent: (event: ScanEvent) => Promise<void>;
  onUsage?: (usage: Usage) => Promise<void> | void;
  traceMetadata?: Record<string, string>;
}

export interface ScanResult {
  findings: FindingDraft[];
  dependencies: Dependency[];
  summary: ScanSummary;
  audit: AuditReport | null;
  stats: ScanStats;
  inventory: Inventory;
  /** The resolved code, so the caller can clean it up. */
  snapshot: Snapshot;
}

const STEP_LABELS: Record<ScanStep, string> = {
  fetch: "Fetching the code",
  inventory: "Mapping every file",
  dependencies: "Listing packages and their latest versions",
  secrets: "Looking for committed keys and unsafe settings",
  vulnerabilities: "Checking packages against the vulnerability database",
  docs: "Checking packages against current documentation",
  review: "Reading the code",
  crosscheck: "Comparing files against each other",
  audit: "Judging launch readiness",
  rank: "Sorting what was found",
};

/**
 * Runs one scan end to end over a snapshot. The runner owns the budget,
 * the event log and the order of checks; the checks own the judgement.
 */
export async function runScan(config: EngineConfig, input: ScanInput): Promise<ScanResult> {
  const started = Date.now();
  const budget = config.budgets[input.kind];
  const signal = input.signal ?? new AbortController().signal;
  const emit = input.onEvent;
  const note = (text: string) => emit({ type: "note", text });
  const stats: ScanStats = { filesSeen: 0, filesRead: 0, checksRun: 0, dependencies: 0, inputTokens: 0, outputTokens: 0, costMicrodollars: 0, durationMs: 0 };

  const models = new ModelClient(config, {
    maxInputTokens: budget.maxInputTokens,
    ...(input.traceMetadata ? { traceMetadata: input.traceMetadata } : {}),
    onUsage: async (usage) => {
      stats.inputTokens += usage.inputTokens;
      stats.outputTokens += usage.outputTokens;
      stats.costMicrodollars += usage.costMicrodollars;
      await input.onUsage?.(usage);
    },
  });

  const { active, unavailable } = checksFor(input.kind, config);
  const needsFetch = typeof input.snapshot === "function";
  const steps = orderedSteps(active, budget.audit, needsFetch);
  await emit({ type: "scan_started", kind: input.kind, steps });
  for (const check of unavailable) await note(`${check.label}: skipped, the service it needs is not configured.`);

  // Fetch
  let snapshot: Snapshot;
  if (typeof input.snapshot === "function") {
    const fetchStart = Date.now();
    await emit({ type: "step_started", step: "fetch", label: STEP_LABELS.fetch });
    snapshot = await input.snapshot();
    await emit({ type: "step_done", step: "fetch", findings: 0, durationMs: Date.now() - fetchStart });
  } else {
    snapshot = input.snapshot;
  }

  // Inventory
  await emit({ type: "step_started", step: "inventory", label: STEP_LABELS.inventory });
  const inventory = await walkInventory(snapshot.root);
  stats.filesSeen = inventory.files.length;
  const candidates = prioritise(inventory.files).filter((f) => f.language !== null);
  const filesToRead = candidates.slice(0, budget.maxFilesRead);
  stats.filesRead = filesToRead.length;
  await emit({
    type: "inventory",
    filesSeen: inventory.files.length,
    filesToRead: filesToRead.length,
    languages: inventory.languages,
    folders: inventory.folders.map((f) => ({ name: f.name, files: f.files.slice(0, 400) })),
  });
  if (inventory.files.length > filesToRead.length) {
    await note(`${filesToRead.length} of ${inventory.files.length} files are read in full by this tier, chosen by how much they affect security and correctness.`);
  }
  await emit({ type: "step_done", step: "inventory", findings: 0, durationMs: Date.now() - started });

  // Dependencies
  const rawDependencies = await collectDependencies(inventory);
  const dependencies = rawDependencies.map(toDependency);
  stats.dependencies = dependencies.length;
  const digest = buildDigest(inventory, dependencies, input.appDescription ?? null);

  const readCache = new Map<string, string>();
  const read = async (path: string): Promise<string> => {
    const cached = readCache.get(path);
    if (cached !== undefined) return cached;
    const raw = await readFile(join(snapshot.root, path), "utf8");
    const windowed = raw.length > budget.maxFileBytes ? raw.slice(0, budget.maxFileBytes) + `\n... (${raw.length - budget.maxFileBytes} more characters not shown)` : raw;
    if (readCache.size > 400) readCache.clear();
    readCache.set(path, windowed);
    return windowed;
  };

  const findings: FindingDraft[] = [];
  const ctx: CheckContext = {
    config,
    kind: input.kind,
    budget,
    snapshot,
    inventory,
    rawDependencies,
    dependencies,
    filesToRead,
    digest,
    models,
    read,
    emit,
    note,
    signal,
    appDescription: input.appDescription ?? null,
    findingsSoFar: findings,
  };

  // Checks, grouped by step so the progress view shows one line per step.
  const byStep = new Map<ScanStep, Check[]>();
  for (const check of active) byStep.set(check.step, [...(byStep.get(check.step) ?? []), check]);
  for (const step of steps) {
    if (signal.aborted) break;
    const checks = byStep.get(step);
    if (!checks) continue;
    const stepStart = Date.now();
    if (step !== "review" && step !== "docs") await emit({ type: "step_started", step, label: STEP_LABELS[step] });
    let count = 0;
    for (const check of checks) {
      if (signal.aborted) break;
      try {
        const produced = await check.run(ctx);
        for (const f of produced) {
          findings.push(f);
          if (check.step !== "review" && check.step !== "docs" && check.step !== "crosscheck") {
            await emit({ type: "finding", finding: { ...f, id: f.key } });
          }
        }
        count += produced.length;
        stats.checksRun += 1;
      } catch (error) {
        if (signal.aborted) break;
        await note(`${check.label}: could not finish (${error instanceof Error ? error.message.slice(0, 160) : String(error)}).`);
      }
    }
    await emit({ type: "step_done", step, findings: count, durationMs: Date.now() - stepStart });
  }

  if (signal.aborted) {
    stats.durationMs = Date.now() - started;
    const ranked = rankFindings(findings);
    return { findings: ranked, dependencies, summary: summarise(ranked, ranked.map((f) => f.key)), audit: null, stats, inventory, snapshot };
  }

  // Rank
  await emit({ type: "step_started", step: "rank", label: STEP_LABELS.rank });
  const ranked = rankFindings(findings);
  const summary = summarise(ranked, ranked.map((f) => f.key));
  await emit({ type: "step_done", step: "rank", findings: ranked.length, durationMs: 0 });

  // Audit
  let audit: AuditReport | null = null;
  if (budget.audit) {
    const auditStart = Date.now();
    await emit({ type: "step_started", step: "audit", label: STEP_LABELS.audit });
    audit = await runAudit(ctx, ranked);
    await emit({ type: "step_done", step: "audit", findings: 0, durationMs: Date.now() - auditStart });
  }

  stats.durationMs = Date.now() - started;
  await emit({ type: "scan_done", findings: ranked.length, durationMs: stats.durationMs });
  return { findings: ranked, dependencies, summary, audit, stats, inventory, snapshot };
}

function orderedSteps(active: Check[], audit: boolean, fetch: boolean): ScanStep[] {
  const order: ScanStep[] = ["fetch", "inventory", "dependencies", "secrets", "vulnerabilities", "docs", "review", "crosscheck", "rank", "audit"];
  const present = new Set<ScanStep>(["inventory", "rank"]);
  if (fetch) present.add("fetch");
  for (const check of active) present.add(check.step);
  if (audit) present.add("audit");
  return order.filter((s) => present.has(s));
}

export { STEP_LABELS };
