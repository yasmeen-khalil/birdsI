import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import type { EngineConfig } from "../config";

export interface Usage {
  model: string;
  inputTokens: number;
  /** Of the input tokens, how many were read from or written to the provider cache. */
  cachedTokens: number;
  outputTokens: number;
  costMicrodollars: number;
  purpose: string;
}

export type UsageSink = (usage: Usage) => void | Promise<void>;

/**
 * Runs before every provider call. A caller uses it to refuse the call (by
 * throwing) once a spending limit outside the client is reached.
 */
export type BeforeCall = (call: { purpose: string; model: string }) => void | Promise<void>;

export interface CompleteOptions<T> {
  purpose: string;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  /** JSON schema repeated in the prompt; derived from the zod schema by the caller. */
  jsonSchema: Record<string, unknown>;
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

export class BudgetExceededError extends Error {
  override name = "BudgetExceededError";
}

interface RawUsage {
  /** Uncached input tokens, billed at the model's input price. */
  inputTokens: number;
  /** Read from the provider's cache: a tenth of the input price. */
  cacheReadTokens?: number;
  /** Written to the cache: a quarter more than the input price. */
  cacheCreationTokens?: number;
  outputTokens: number;
}

/**
 * The one door to a model. Since v3 only the official-docs check uses it:
 * the map, the connectors, the alerts and the cockpit run without a model.
 * Every call is counted against the scan budget and priced into the usage
 * ledger, and the caller can refuse a call once a daily limit is reached.
 */
export class ModelClient {
  private readonly anthropic: Anthropic | null;
  private inputSpent = 0;
  private throttled = 0;

  constructor(
    private readonly config: EngineConfig,
    private readonly options: {
      onUsage?: UsageSink;
      beforeCall?: BeforeCall;
      maxInputTokens?: number;
    } = {},
  ) {
    // Every 429 (rate limit) and 529 (overloaded) answer is counted, so a slow scan can say why.
    const countingFetch: typeof fetch = async (url, init) => {
      const response = await fetch(url, init);
      if (response.status === 429 || response.status === 529) this.throttled += 1;
      return response;
    };
    this.anthropic = config.anthropic.apiKey ? new Anthropic({ apiKey: config.anthropic.apiKey, maxRetries: 3, timeout: 120_000, fetch: countingFetch }) : null;
  }

  get available(): boolean {
    return this.anthropic !== null;
  }

  get model(): string {
    return this.config.models.docs;
  }

  get inputTokensSpent(): number {
    return this.inputSpent;
  }

  /** Provider answers that said "slow down" (429) or "overloaded" (529); each one cost a retry and a wait. */
  get throttledCalls(): number {
    return this.throttled;
  }

  /** Rough token estimate for budgeting before a call is made. */
  static estimateTokens(text: string): number {
    return Math.ceil(text.length / 3.6);
  }

  private assertBudget(estimatedInput: number): void {
    const max = this.options.maxInputTokens;
    if (max !== undefined && this.inputSpent + estimatedInput > max) {
      throw new BudgetExceededError(`Scan budget reached (${this.inputSpent.toLocaleString()} of ${max.toLocaleString()} input tokens).`);
    }
  }

  private async record(purpose: string, usage: RawUsage): Promise<void> {
    const model = this.model;
    const cacheRead = usage.cacheReadTokens ?? 0;
    const cacheCreation = usage.cacheCreationTokens ?? 0;
    const totalInput = usage.inputTokens + cacheRead + cacheCreation;
    this.inputSpent += totalInput;
    const price = this.config.prices[model] ?? { input: 0, output: 0 };
    // Cached reads cost a tenth of the input price; writing the cache costs a quarter more.
    const costMicrodollars = Math.round((usage.inputTokens * price.input + cacheRead * price.input * 0.1 + cacheCreation * price.input * 1.25 + usage.outputTokens * price.output) / 1_000_000);
    await this.options.onUsage?.({ model, inputTokens: totalInput, cachedTokens: cacheRead + cacheCreation, outputTokens: usage.outputTokens, costMicrodollars, purpose });
  }

  /**
   * Structured completion. The schema is enforced by Claude's structured
   * outputs and validated again with zod; one repair attempt follows a bad parse.
   */
  async complete<T>(opts: CompleteOptions<T>): Promise<T> {
    const client = this.anthropic;
    if (!client) throw new Error("ANTHROPIC_API_KEY is not set.");
    const model = this.model;
    const system = `${opts.system}\n\nRespond with a single JSON object that follows this JSON schema exactly, with no prose before or after:\n${JSON.stringify(opts.jsonSchema)}`;
    this.assertBudget(ModelClient.estimateTokens(system + opts.user));

    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      const messages: Anthropic.MessageParam[] = [{ role: "user", content: opts.user }];
      if (attempt > 0 && lastError instanceof Error) {
        messages.push({ role: "user", content: `The previous answer did not match the schema: ${lastError.message.slice(0, 500)}. Answer again with valid JSON only, and keep every text field short so the whole answer fits.` });
      }
      await this.options.beforeCall?.({ purpose: opts.purpose, model });
      // One call, parsed here: the SDK's own parse throws on a reply cut off at
      // max_tokens and loses that call's usage, so the raw text is read instead.
      const response = await client.messages.create(
        {
          model,
          max_tokens: opts.maxOutputTokens ?? 4096,
          system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
          messages,
          output_config: { format: zodOutputFormat(opts.schema as never) },
        },
        { signal: opts.signal ?? undefined },
      );
      assertNotRefused(response, opts.purpose);
      await this.record(opts.purpose, usageOf(response));
      const text = textOf(response);
      try {
        return opts.schema.parse(extractJson(response.stop_reason === "max_tokens" ? `${text}\n` : text));
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(`Model output did not match the expected shape for ${opts.purpose}: ${String(lastError)}`);
  }
}

function usageOf(response: Anthropic.Message): RawUsage {
  return {
    inputTokens: response.usage.input_tokens,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
    outputTokens: response.usage.output_tokens,
  };
}

function textOf(response: Anthropic.Message): string {
  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

function assertNotRefused(response: Anthropic.Message, purpose: string): void {
  if (response.stop_reason === "refusal") {
    const detail = response.stop_details && "explanation" in response.stop_details ? String(response.stop_details.explanation ?? "") : "";
    throw new Error(`The model declined this request (${purpose})${detail ? `: ${detail}` : "."}`);
  }
}

/** Pulls the first JSON object out of a reply, tolerating code fences and reasoning preambles. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced?.[1] ?? trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      throw new Error("No JSON object found in the model reply");
    }
    return JSON.parse(candidate.slice(start, end + 1));
  }
}
