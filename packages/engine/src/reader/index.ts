import { createHash } from "node:crypto";
import type { ModelFind, ReaderStats, ScanEvent, ServiceMap } from "@birdsi/shared";
import { isBudget } from "../checks/model-findings";
import { runPool } from "../checks/pool";
import { isCodeLanguage, isConfigLanguage } from "../inventory/languages";
import { prioritise } from "../inventory/priority";
import type { Inventory, InventoryFile } from "../inventory/walk";
import { isTestPath } from "../map/files";
import type { MapContext } from "../map/index";
import type { ModelClient } from "../models/client";
import { batchSegments, batchText, segmentsOf, tokensOf, type Batch } from "./chunks";
import { Finds, FINDS_JSON_SCHEMA, mapSummary, Purposes, PURPOSES_JSON_SCHEMA, PURPOSES_SYSTEM, READER_SYSTEM, type Find } from "./schema";
import { alreadyKnown, confirmFind, mergeFind, type MergeContext } from "./verify";

export interface ReadInput {
  inventory: Inventory;
  /** The rules' map. The result is this map with the model's confirmed finds merged in. */
  map: ServiceMap;
  context: MapContext;
  models: ModelClient;
  /** The previous map of the same repository, so unchanged files are not read again. */
  previous: ServiceMap | null;
  /** Input tokens the reading may spend in this map. */
  maxInputTokens: number;
  concurrency: number;
  emit: (event: ScanEvent) => Promise<void>;
  signal: AbortSignal;
}

export interface ReadResult {
  map: ServiceMap;
  stats: ReaderStats;
}

/** Files worth the model's time: code and configuration, not tests, docs or data. */
export function readable(file: InventoryFile): boolean {
  if (isTestPath(file.path)) return false;
  if (/\.(md|mdx|txt|csv|svg|lock)$/i.test(file.path) || /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/.test(file.path)) return false;
  return isCodeLanguage(file.language) || isConfigLanguage(file.language) || /(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/.test(file.path);
}

function sha1(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}

/**
 * The second reader. The model reads the code in batches, with the rules'
 * map as the stable prefix of every call, and names what the map lacks.
 * Every find is confirmed at its file and line before it joins the map, and
 * a find whose line does not say what the model claimed is dropped. Files
 * unchanged since the previous map are not read again: their finds are
 * carried over and confirmed afresh.
 */
export async function readWithModel(input: ReadInput): Promise<ReadResult> {
  const { map, context, models, signal } = input;
  const model = models.modelId("nano");
  const stats: ReaderStats = { model, filesRead: 0, filesUnchanged: 0, filesSkipped: 0, filesOverBudget: 0, batches: 0, finds: 0, confirmed: 0, dropped: 0, known: 0, carried: 0 };
  const merge: MergeContext = { map, context, model, areas: null };
  const summary = mapSummary(map);

  // Every readable file is hashed; the ones the previous map saw unchanged are not read again.
  const previousHashes = input.previous?.fileHashes ?? {};
  const hashes: Record<string, string> = {};
  const contents = new Map<string, string>();
  const toRead: InventoryFile[] = [];
  for (const file of prioritise(input.inventory.files.filter(readable))) {
    const content = await context.files.text(file.path);
    if (content === null) {
      stats.filesSkipped += 1;
      continue;
    }
    const hash = sha1(content);
    hashes[file.path] = hash;
    contents.set(file.path, content);
    if (previousHashes[file.path] === hash) stats.filesUnchanged += 1;
    else toRead.push(file);
  }

  // Finds of the previous map whose files are unchanged, confirmed again on today's files.
  for (const f of input.previous?.modelFinds ?? []) {
    if (previousHashes[f.at.path] === undefined || previousHashes[f.at.path] !== hashes[f.at.path]) continue;
    const find: Find = { kind: f.kind, name: f.name, detail: f.detail, category: (f.category as Find["category"]) ?? null, schedule: f.schedule, path: f.at.path, line: f.at.line, quote: f.at.text };
    const at = confirmFind(find, contents.get(f.at.path) ?? null);
    if (!at || alreadyKnown(map, find, at)) continue;
    const merged = await mergeFind(merge, find, at);
    map.modelFinds.push({ kind: f.kind, name: f.name, detail: f.detail, category: f.category, schedule: f.schedule, at, merged });
    stats.carried += 1;
  }

  // The batches, in priority order, within the reading budget.
  const segments = toRead.flatMap((file) => segmentsOf(file.path, contents.get(file.path)!));
  const all = batchSegments(segments);
  let tokens = tokensOf(summary.length + READER_SYSTEM.length);
  const batches: Batch[] = [];
  for (const batch of all) {
    const cost = tokensOf(batch.chars);
    if (tokens + cost > input.maxInputTokens) break;
    tokens += cost;
    batches.push(batch);
  }
  const overBudget = new Set(all.slice(batches.length).flatMap((b) => b.segments.map((s) => s.path)));
  stats.filesOverBudget = overBudget.size;
  stats.filesRead = new Set(batches.flatMap((b) => b.segments.map((s) => s.path))).size;
  stats.batches = batches.length;

  await input.emit({ type: "step_progress", step: "review", done: 0, total: batches.length });
  const finds: Find[] = [];
  let done = 0;
  let stopped = false;
  await runPool(batches, input.concurrency, async (batch) => {
    if (stopped || signal.aborted) return;
    try {
      const answer = await models.complete({
        tier: "nano",
        purpose: "reader",
        system: READER_SYSTEM,
        cachedContext: summary,
        user: batchText(batch),
        schema: Finds,
        jsonSchema: FINDS_JSON_SCHEMA,
        schemaName: "finds",
        maxOutputTokens: 6000,
        signal,
      });
      finds.push(...answer.finds);
    } catch (error) {
      if (signal.aborted) return;
      // The daily spend limit stops the reading quietly: what was read stays, the rest waits for the next map.
      if (isBudget(error)) stopped = true;
      else await input.emit({ type: "note", text: `One batch of the model's reading did not finish (${error instanceof Error ? error.message.slice(0, 160) : String(error)}).` });
    } finally {
      done += 1;
      await input.emit({ type: "step_progress", step: "review", done, total: batches.length });
    }
  });

  // Every find is confirmed at its line before it joins the map.
  stats.finds = finds.length;
  for (const find of finds) {
    if (!context.files.has(find.path)) {
      stats.dropped += 1;
      continue;
    }
    const at = confirmFind(find, contents.get(find.path) ?? (await context.files.text(find.path)));
    if (!at) {
      stats.dropped += 1;
      continue;
    }
    if (alreadyKnown(map, find, at)) {
      stats.known += 1;
      continue;
    }
    const merged = await mergeFind(merge, find, at);
    const kept: ModelFind = { kind: find.kind, name: find.name, detail: find.detail, category: find.category, schedule: find.schedule, at, merged };
    map.modelFinds.push(kept);
    stats.confirmed += 1;
  }

  // What the app uses each service for, as the model reads it from the call sites.
  if (!signal.aborted && !stopped) await writePurposes(input, map);

  map.reader = stats;
  map.fileHashes = hashes;
  return { map, stats };
}

async function writePurposes(input: ReadInput, map: ServiceMap): Promise<void> {
  const previous = new Map((input.previous?.services ?? []).filter((s) => s.purpose).map((s) => [s.slug, s.purpose!]));
  for (const s of map.services) if (!s.purpose && previous.has(s.slug)) s.purpose = previous.get(s.slug)!;
  const wanting = map.services.filter((s) => !s.purpose && (s.imports.length > 0 || s.sources.length > 0));
  if (wanting.length === 0) return;
  const user = wanting
    .map((s) => {
      const lines = [...s.imports, ...s.sources].slice(0, 6).map((l) => `  ${l.path}:${l.line}  ${l.text}`);
      return `- ${s.slug} (${s.name})\n${lines.join("\n")}`;
    })
    .join("\n");
  try {
    const answer = await input.models.complete({ tier: "nano", purpose: "purposes", system: PURPOSES_SYSTEM, user: `Services and the lines that use them:\n${user}`, schema: Purposes, jsonSchema: PURPOSES_JSON_SCHEMA, schemaName: "purposes", maxOutputTokens: 4000, signal: input.signal });
    const by = new Map(answer.purposes.map((p) => [p.slug, p.purpose]));
    for (const s of wanting) {
      const purpose = by.get(s.slug)?.trim();
      if (purpose) s.purpose = purpose.slice(0, 200);
    }
  } catch (error) {
    if (input.signal.aborted) return;
    await input.emit({ type: "note", text: `The services' purposes could not be read (${error instanceof Error ? error.message.slice(0, 160) : String(error)}).` });
  }
}

/** The run's one line about the reading. */
export function readerNote(stats: ReaderStats): string {
  const parts = [`The model (${stats.model}) read ${stats.filesRead} ${stats.filesRead === 1 ? "file" : "files"} in ${stats.batches} ${stats.batches === 1 ? "pass" : "passes"}`];
  if (stats.filesUnchanged > 0) parts.push(`${stats.filesUnchanged} unchanged since the previous map were not read again`);
  parts.push(`${stats.confirmed} ${stats.confirmed === 1 ? "find" : "finds"} confirmed at their lines`);
  if (stats.carried > 0) parts.push(`${stats.carried} carried over`);
  if (stats.dropped > 0) parts.push(`${stats.dropped} dropped because the line did not say what was claimed`);
  if (stats.known > 0) parts.push(`${stats.known} already on the map`);
  if (stats.filesOverBudget > 0) parts.push(`${stats.filesOverBudget} files left for the next map, over this map's reading budget`);
  if (stats.filesSkipped > 0) parts.push(`${stats.filesSkipped} skipped as minified or too large`);
  return `${parts.join(", ")}.`;
}
