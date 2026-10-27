import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Dependency, FindingDraft, ProjectHints, Prompts, ScanEvent, ScanScope, ScanStats, ScanStep, ScanSummary, ServiceMap, VendorDraft } from "@birdsi/shared";
import { checksFor } from "../checks/registry";
import type { Check, CheckContext } from "../checks/types";
import { toDependency } from "../checks/vulnerabilities";
import type { EngineConfig } from "../config";
import { collectDependencies } from "../inventory/manifests";
import { prioritise } from "../inventory/priority";
import { walkInventory, type Inventory } from "../inventory/walk";
import { ModelClient, type BeforeCall, type Usage } from "../models/client";
import { buildServiceMapWithContext, type MapContext } from "../map/index";
import { readerNote, readWithModel } from "../reader/index";
import type { Snapshot } from "../source/types";
import { discoverVendors } from "../vendors/discover";
import { rankFindings, summarise } from "./rank";

export interface ScanInput {
  /** The code, or a function that fetches it; the fetch is then a visible step. */
  snapshot: Snapshot | (() => Promise<Snapshot>);
  /** Hints the CLI collected on the owner's machine (Stripe Projects state and spend). */
  projectHints?: ProjectHints | null;
  /** Slugs of the vendors the owner declared projects for, so each has a row even when the code never names it. */
  declaredVendors?: string[];
  /** Called as soon as the vendors are known, before the slower steps, so the dashboard can show them at once. */
  onVendors?: (vendors: VendorDraft[]) => Promise<void> | void;
  /** Called with the service map once it is complete: the rules' map, with the model's confirmed finds when a model read the code. Called even when a later step stops. */
  onMap?: (map: ServiceMap) => Promise<void> | void;
  /** The previous map of the same repository, so the model reads only the files that changed. */
  previousMap?: ServiceMap | null;
  /** The owner's additions to the prompts, by section. */
  prompts?: Prompts;
  signal?: AbortSignal;
  onEvent: (event: ScanEvent) => Promise<void>;
  onUsage?: (usage: Usage) => Promise<void> | void;
  /** Runs before every model call; throwing refuses the call (a daily spending limit). */
  beforeCall?: BeforeCall;
}

export interface ScanResult {
  findings: FindingDraft[];
  dependencies: Dependency[];
  summary: ScanSummary;
  stats: ScanStats;
  inventory: Inventory;
  /** Outside services the code depends on, found deterministically. */
  vendors: VendorDraft[];
  /** Deployments, env names, crons, webhooks, store apps, migrations and public pages, each with its file and line. Null when it could not be read. */
  map: ServiceMap | null;
  /** The resolved code, so the caller can clean it up. */
  snapshot: Snapshot;
}

const STEP_LABELS: Record<ScanStep, string> = {
  fetch: "Fetching the code",
  inventory: "Mapping every file",
  dependencies: "Listing packages and their latest versions",
  vendors: "Finding the services the app runs on",
  map: "Mapping deployments, crons, webhooks, store apps and migrations",
  gaps: "Checking the map for gaps, redundancies and stale code",
  secrets: "Looking for committed keys and unsafe settings",
  vulnerabilities: "Checking packages against the vulnerability database",
  docs: "Checking packages against their own current documentation",
  review: "Reading the code with the model, confirming every find at its line",
  crosscheck: "Comparing files against each other",
  audit: "Judging launch readiness",
  rank: "Sorting what was found",
};

/**
 * Maps one snapshot of an app's code: every file, package and outside
 * service, the service map (deployments, env names, crons, webhooks, store
 * apps, migrations, public pages) read by rules, then the model's reading of
 * the code for what the rules missed, every find confirmed at its line, then
 * the rule-based checks and the docs check. The model steps run only when a
 * model key is set.
 */
export async function runScan(config: EngineConfig, input: ScanInput): Promise<ScanResult> {
  const started = Date.now();
  const budget = config.budget;
  const signal = input.signal ?? new AbortController().signal;
  const emit = input.onEvent;
  const note = (text: string) => emit({ type: "note", text });
  const stats: ScanStats = { filesSeen: 0, filesRead: 0, checksRun: 0, dependencies: 0, inputTokens: 0, cachedTokens: 0, throttledCalls: 0, outputTokens: 0, costMicrodollars: 0, durationMs: 0 };

  const models = new ModelClient(config, {
    maxInputTokens: budget.maxInputTokens + budget.maxReadTokens,
    ...(input.beforeCall ? { beforeCall: input.beforeCall } : {}),
    onUsage: async (usage) => {
      stats.inputTokens += usage.inputTokens;
      stats.outputTokens += usage.outputTokens;
      stats.costMicrodollars += usage.costMicrodollars;
      stats.cachedTokens += usage.cachedTokens;
      await input.onUsage?.(usage);
    },
  });

  const { active, unavailable } = checksFor(config);
  const needsFetch = typeof input.snapshot === "function";
  const readerPlanned = config.reader.enabled && models.available;
  const steps = orderedSteps(active, needsFetch, readerPlanned);
  await emit({ type: "scan_started", kind: "light", steps });
  for (const check of unavailable) await note(`${check.label}: skipped, the keys it needs are not set on this birdsI.`);
  if (config.reader.enabled && !models.available) await note("The model's reading of the code: skipped, no model key is set on this birdsI. The map is what the rules read.");

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
  const filesToRead = prioritise(inventory.files)
    .filter((f) => f.language !== null)
    .slice(0, budget.maxFilesRead);
  stats.filesRead = filesToRead.length;
  await emit({
    type: "inventory",
    filesSeen: inventory.files.length,
    filesToRead: filesToRead.length,
    languages: inventory.languages,
    folders: inventory.folders.map((f) => ({ name: f.name, files: f.files.slice(0, 400) })),
  });
  await emit({ type: "step_done", step: "inventory", findings: 0, durationMs: Date.now() - started });

  // Dependencies
  const rawDependencies = await collectDependencies(inventory);
  const dependencies = rawDependencies.map(toDependency);
  stats.dependencies = dependencies.length;

  // Vendors: every outside service, found from packages, env names, URLs and config files.
  const vendorsStart = Date.now();
  await emit({ type: "step_started", step: "vendors", label: STEP_LABELS.vendors });
  const vendors = await discoverVendors(inventory, rawDependencies, input.projectHints ?? null, input.declaredVendors ?? []);
  for (const v of vendors) await emit({ type: "vendor", slug: v.slug, name: v.name, category: v.category, detectedBy: v.detectedBy });
  await emit({ type: "step_done", step: "vendors", findings: 0, durationMs: Date.now() - vendorsStart });
  if (vendors.length > 0) await input.onVendors?.(vendors);

  // Map: what each deployment needs, by rules, with the file and line for every entry.
  let map: ServiceMap | null = null;
  let mapContext: MapContext | null = null;
  if (!signal.aborted) {
    const mapStart = Date.now();
    await emit({ type: "step_started", step: "map", label: STEP_LABELS.map });
    try {
      const built = await buildServiceMapWithContext(inventory, rawDependencies, vendors, { commit: snapshot.commitSha ?? null, branch: snapshot.branch ?? null });
      map = built.map;
      mapContext = built.context;
      await emit({
        type: "service_map",
        services: map.services.length,
        envNames: map.env.length,
        crons: map.crons.length,
        webhooks: map.webhooks.length,
        storeApps: map.storeApps.length,
        migrations: map.migrations.files.length,
        roles: map.roles.names,
      });
    } catch (error) {
      await note(`The service map could not be read (${error instanceof Error ? error.message.slice(0, 160) : String(error)}).`);
    }
    await emit({ type: "step_done", step: "map", findings: 0, durationMs: Date.now() - mapStart });
  }

  // The model reads the code for what the rules missed; every find is confirmed at its line before it joins the map.
  let readerLine: string | null = null;
  if (readerPlanned && !signal.aborted) {
    const readStart = Date.now();
    await emit({ type: "step_started", step: "review", label: STEP_LABELS.review });
    if (map && mapContext) {
      try {
        const read = await readWithModel({ inventory, map, context: mapContext, models, previous: input.previousMap ?? null, maxInputTokens: budget.maxReadTokens, concurrency: budget.readConcurrency, prompts: input.prompts ?? {}, emit, signal });
        map = read.map;
        readerLine = readerNote(read.stats);
        await note(readerLine);
        for (const v of vendors) {
          const purpose = map.services.find((s) => s.slug === v.slug)?.purpose;
          if (purpose) v.purpose = purpose;
        }
      } catch (error) {
        if (!signal.aborted) await note(`The model's reading did not finish (${error instanceof Error ? error.message.slice(0, 160) : String(error)}). The map keeps what the rules read.`);
      }
    } else {
      await note("The model's reading was skipped because the service map could not be read.");
    }
    await emit({ type: "step_done", step: "review", findings: 0, durationMs: Date.now() - readStart });
  }
  if (map) await input.onMap?.(map);

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
    budget,
    snapshot,
    inventory,
    rawDependencies,
    dependencies,
    filesToRead,
    map,
    mapContext,
    prompts: input.prompts ?? {},
    models,
    read,
    emit,
    note,
    signal,
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
    if (step !== "docs") await emit({ type: "step_started", step, label: STEP_LABELS[step] });
    let count = 0;
    for (const check of checks) {
      if (signal.aborted) break;
      try {
        const produced = await check.run(ctx);
        for (const f of produced) {
          findings.push(f);
          if (check.step !== "docs") await emit({ type: "finding", finding: { ...f, id: f.key } });
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

  const ranked = rankFindings(findings);
  const scope: ScanScope = {
    checked: [
      ...(map ? [{ id: "map", label: STEP_LABELS.map, detail: `${map.counts.files} files, ${map.counts.packages} packages and ${map.counts.routes} routes read by rules: services, env names per deployment, crons, webhooks, store apps, migrations and public pages, each with its file and line.` }] : []),
      ...(readerLine ? [{ id: "reader", label: STEP_LABELS.review, detail: readerLine }] : []),
      ...active.map((c) => ({ id: c.id, label: c.label, detail: c.scope })),
    ],
    notChecked: [
      ...(readerPlanned ? [] : [{ id: "reader", label: STEP_LABELS.review, why: config.reader.enabled ? "No model key is set on this birdsI." : "Turned off with BIRDSI_READER=off." }]),
      ...unavailable.map((c) => ({ id: c.id, label: c.label, why: c.needs ? `It needs ${c.needs}.` : "The keys it needs are not set." })),
      { id: "logic", label: "The code's own logic", why: "No model judges authorization, input handling or business rules in this version. Everything above is a rule, a database or a cited document." },
    ],
    model: { provider: config.provider, model: models.available ? models.modelId("nano") : null, readTheCode: readerLine !== null, docsCheck: active.some((c) => c.id === "docs") },
  };
  const summary = summarise(ranked, ranked.map((f) => f.key), scope);
  if (signal.aborted) {
    stats.durationMs = Date.now() - started;
    return { findings: ranked, dependencies, summary, stats, inventory, vendors, map, snapshot };
  }

  // Rank
  await emit({ type: "step_started", step: "rank", label: STEP_LABELS.rank });
  await emit({ type: "step_done", step: "rank", findings: ranked.length, durationMs: 0 });

  stats.durationMs = Date.now() - started;
  stats.throttledCalls = models.throttledCalls;
  if (stats.throttledCalls > 0) await note(`${stats.throttledCalls} model calls were slowed by the provider's rate limit and retried.`);
  await emit({ type: "scan_done", findings: ranked.length, durationMs: stats.durationMs });
  return { findings: ranked, dependencies, summary, stats, inventory, vendors, map, snapshot };
}

function orderedSteps(active: Check[], fetch: boolean, reader: boolean): ScanStep[] {
  const order: ScanStep[] = ["fetch", "inventory", "dependencies", "vendors", "map", "review", "gaps", "secrets", "vulnerabilities", "docs", "rank"];
  const present = new Set<ScanStep>(["inventory", "vendors", "map", "rank"]);
  if (fetch) present.add("fetch");
  if (reader) present.add("review");
  for (const check of active) present.add(check.step);
  return order.filter((s) => present.has(s));
}

export { STEP_LABELS };
