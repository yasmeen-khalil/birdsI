import { recordUsage, saveLimitsWatch, type JobRow } from "@birdsi/db";
import { ModelClient, tavilyExtract, watchLimits, type EngineConfig } from "@birdsi/engine";
import { spendHook } from "./spend";

/**
 * The weekly watch over the pricing pages the checked limits list rests on.
 * Tavily fetches each page, code checks every quoted sentence, and the large
 * model proposes what a page says now when a sentence is gone. The rows go
 * to limits_watch, and the next read of every app turns a changed page into
 * a notice for the apps that use that vendor.
 */
export async function runLimitsWatchJob(config: EngineConfig, _job: JobRow, heartbeat: () => Promise<void>): Promise<void> {
  if (!config.tavilyApiKey) {
    console.log("[worker] limits watch skipped: TAVILY_API_KEY is not set");
    return;
  }
  const spend = spendHook(null);
  const models = new ModelClient(config, { beforeCall: spend.beforeCall, onUsage: (u) => recordUsage({ ownerUserId: null, scanId: null, purpose: u.purpose, model: u.model, inputTokens: u.inputTokens, outputTokens: u.outputTokens, costMicrodollars: u.costMicrodollars }) });
  const rows = await watchLimits({ extract: tavilyExtract(config.tavilyApiKey), models: models.available ? models : null, onProgress: () => heartbeat(), onWarn: (message) => console.error(`[worker] limits watch: ${message}`) });
  const kept = await saveLimitsWatch(rows);
  const changed = rows.filter((r) => r.missing.length > 0).length;
  const failed = rows.filter((r) => r.error).length;
  console.log(`[worker] limits watch: ${rows.length} pages checked, ${changed} with a sentence gone, ${failed} not fetched${kept ? "" : ", not kept: the limits_watch migration has not run"}`);
}
