import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import type { EngineConfig, ModelPrice, ModelTier, Provider } from "../config";

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
  /** Which size of model answers: nano for reading and everyday calls, super for verification and judgment. */
  tier?: ModelTier;
  purpose: string;
  system: string;
  /** Stable text shared by many calls in one map (the map, the instructions). Both providers cache it as a prefix. */
  cachedContext?: string;
  user: string;
  schema: z.ZodType<T>;
  /** JSON schema repeated in the prompt and sent to the provider; derived from the zod schema by the caller. */
  jsonSchema: Record<string, unknown>;
  /** The name the schema is sent under to Token Factory. */
  schemaName?: string;
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

export class BudgetExceededError extends Error {
  override name = "BudgetExceededError";
}

export type Fetch = typeof fetch;

interface RawUsage {
  /** Uncached input tokens, billed at the model's input price. */
  inputTokens: number;
  /** Read from the provider's cache, billed at the cached price. */
  cacheReadTokens?: number;
  /** Written to Anthropic's cache: a quarter more than the input price. */
  cacheCreationTokens?: number;
  outputTokens: number;
}

/** What a provider answered: the text, what it cost, and whether the answer stopped at the output limit. */
interface RawReply {
  text: string;
  usage: RawUsage;
  cutOff: boolean;
}

/** The shape of a Token Factory chat completion, read field by field. */
interface ChatCompletion {
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
}

const NO_PRICE: ModelPrice = { input: 0, cachedInput: 0, output: 0 };
/** Waits between retries of a Token Factory call, when the provider names no retry-after. */
const RETRY_WAITS_MS = [1_000, 4_000, 10_000];
const TOKEN_FACTORY_TIMEOUT_MS = 180_000;

/**
 * The one door to a model. Nemotron on Nebius Token Factory and Claude on
 * Anthropic sit behind the same calls, chosen by the provider the config
 * selected. Every call is counted against the map's budget and priced into
 * the usage ledger, and the caller can refuse a call once a daily limit is
 * reached. Today only the docs check uses it.
 */
export class ModelClient {
  private readonly anthropic: Anthropic | null;
  private readonly fetchImpl: Fetch;
  private inputSpent = 0;
  private throttled = 0;
  /** Models for which Token Factory refused the strict schema format, answered in plain JSON mode from then on. */
  private readonly plainJson = new Set<string>();

  constructor(
    private readonly config: EngineConfig,
    private readonly options: {
      onUsage?: UsageSink;
      beforeCall?: BeforeCall;
      maxInputTokens?: number;
      /** Replaces the global fetch, for tests. */
      fetch?: Fetch;
    } = {},
  ) {
    const base = options.fetch ?? fetch;
    // Every "slow down" (429), "unavailable" (503) and "overloaded" (529) answer is counted, so a slow map can say why.
    const countingFetch: Fetch = async (url, init) => {
      const response = await base(url, init);
      if (response.status === 429 || response.status === 503 || response.status === 529) this.throttled += 1;
      return response;
    };
    this.fetchImpl = countingFetch;
    this.anthropic = config.anthropic.apiKey ? new Anthropic({ apiKey: config.anthropic.apiKey, maxRetries: 3, timeout: 120_000, fetch: countingFetch }) : null;
  }

  get provider(): Provider | null {
    return this.config.provider;
  }

  /** True when the selected provider has its key. */
  get available(): boolean {
    if (this.config.provider === "nebius") return this.config.tokenFactory.apiKey !== null;
    if (this.config.provider === "anthropic") return this.anthropic !== null;
    return false;
  }

  modelId(tier: ModelTier = "nano"): string {
    return this.config.models[tier];
  }

  get inputTokensSpent(): number {
    return this.inputSpent;
  }

  /** Provider answers that said "slow down" or "overloaded"; each one cost a retry and a wait. */
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

  private async record(model: string, purpose: string, usage: RawUsage): Promise<void> {
    const cacheRead = usage.cacheReadTokens ?? 0;
    const cacheCreation = usage.cacheCreationTokens ?? 0;
    const totalInput = usage.inputTokens + cacheRead + cacheCreation;
    this.inputSpent += totalInput;
    const price = this.config.prices[model] ?? NO_PRICE;
    const costMicrodollars = Math.round((usage.inputTokens * price.input + cacheRead * price.cachedInput + cacheCreation * price.input * 1.25 + usage.outputTokens * price.output) / 1_000_000);
    await this.options.onUsage?.({ model, inputTokens: totalInput, cachedTokens: cacheRead + cacheCreation, outputTokens: usage.outputTokens, costMicrodollars, purpose });
  }

  /**
   * Structured completion. The schema is enforced by the provider (Claude's
   * structured outputs, or Token Factory's JSON schema format) and validated
   * again with zod; one repair attempt follows a bad or cut-off answer.
   */
  async complete<T>(opts: CompleteOptions<T>): Promise<T> {
    if (!this.available) throw new Error(this.config.provider === null ? "No model key is set. Add NEBIUS_API_KEY (Nemotron on Token Factory) or ANTHROPIC_API_KEY (Claude)." : `The key for ${this.config.provider} is not set.`);
    const model = this.modelId(opts.tier ?? "nano");
    const system = `${opts.system}\n\nRespond with a single JSON object that follows this JSON schema exactly, with no prose before or after:\n${JSON.stringify(opts.jsonSchema)}`;
    this.assertBudget(ModelClient.estimateTokens(system + (opts.cachedContext ?? "") + opts.user));

    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      const repair = attempt > 0 && lastError instanceof Error ? `The previous answer did not match the schema: ${lastError.message.slice(0, 500)}. Answer again with valid JSON only, and keep every text field short so the whole answer fits.` : null;
      await this.options.beforeCall?.({ purpose: opts.purpose, model });
      const reply = this.config.provider === "nebius" ? await this.completeTokenFactory(model, opts, system, repair) : await this.completeAnthropic(model, opts, system, repair);
      await this.record(model, opts.purpose, reply.usage);
      if (reply.cutOff) {
        lastError = new Error("The answer stopped at the output limit before it was complete.");
        continue;
      }
      try {
        return opts.schema.parse(extractJson(reply.text));
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(`Model output did not match the expected shape for ${opts.purpose}: ${String(lastError)}`);
  }

  private async completeAnthropic<T>(model: string, opts: CompleteOptions<T>, system: string, repair: string | null): Promise<RawReply> {
    const client = this.anthropic;
    if (!client) throw new Error("ANTHROPIC_API_KEY is not set.");
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: opts.user }];
    if (repair) messages.push({ role: "user", content: repair });
    // The system text and the shared context are the stable prefix; the provider caches them across the map's calls.
    const systemBlocks: Anthropic.TextBlockParam[] = [{ type: "text", text: system, cache_control: { type: "ephemeral" } }];
    if (opts.cachedContext) systemBlocks.push({ type: "text", text: opts.cachedContext, cache_control: { type: "ephemeral" } });
    // One call, parsed by the caller: the SDK's own parse throws on a reply cut off at
    // max_tokens and loses that call's usage, so the raw text is read instead.
    const response = await client.messages.create(
      {
        model,
        max_tokens: opts.maxOutputTokens ?? 4096,
        system: systemBlocks,
        messages,
        output_config: { format: zodOutputFormat(opts.schema as never), ...effortFor(model) },
      },
      { signal: opts.signal ?? undefined },
    );
    assertNotRefused(response, opts.purpose);
    return { text: textOf(response), usage: usageOf(response), cutOff: response.stop_reason === "max_tokens" };
  }

  private async completeTokenFactory<T>(model: string, opts: CompleteOptions<T>, system: string, repair: string | null): Promise<RawReply> {
    const key = this.config.tokenFactory.apiKey;
    if (!key) throw new Error("NEBIUS_API_KEY is not set.");
    const url = new URL("chat/completions", this.config.tokenFactory.baseUrl).toString();
    const messages: Array<{ role: "system" | "user"; content: string }> = [
      { role: "system", content: opts.cachedContext ? `${system}\n\n${opts.cachedContext}` : system },
      { role: "user", content: opts.user },
    ];
    if (repair) messages.push({ role: "user", content: repair });
    const strict = !this.plainJson.has(model);
    const body = {
      model,
      messages,
      temperature: 0.1,
      max_tokens: opts.maxOutputTokens ?? 4096,
      response_format: strict ? { type: "json_schema", json_schema: { name: opts.schemaName ?? "answer", schema: opts.jsonSchema } } : { type: "json_object" },
    };
    const response = await this.postWithRetries(url, key, body, opts.signal);
    if (!response.ok) {
      const reason = await errorReason(response);
      // A model that takes no schema still answers in JSON mode; the schema stays in the prompt.
      if (response.status === 400 && strict && /response_format|json_schema|schema/i.test(reason)) {
        this.plainJson.add(model);
        return this.completeTokenFactory(model, opts, system, repair);
      }
      throw new Error(`Token Factory answered ${response.status} for ${opts.purpose}: ${reason}`);
    }
    const data = (await response.json()) as ChatCompletion;
    const choice = data.choices?.[0];
    const usage = data.usage ?? {};
    const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
    return {
      text: choice?.message?.content ?? "",
      usage: { inputTokens: Math.max(0, (usage.prompt_tokens ?? 0) - cached), cacheReadTokens: cached, outputTokens: usage.completion_tokens ?? 0 },
      cutOff: choice?.finish_reason === "length",
    };
  }

  /** One POST with up to three retries on "slow down", server errors and lost connections, honouring retry-after. */
  private async postWithRetries(url: string, key: string, body: unknown, signal: AbortSignal | undefined): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const timeout = AbortSignal.timeout(TOKEN_FACTORY_TIMEOUT_MS);
      let response: Response | null = null;
      let failure: unknown = null;
      try {
        response = await this.fetchImpl(url, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
          body: JSON.stringify(body),
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
      } catch (error) {
        if (signal?.aborted) throw error;
        failure = error;
      }
      const retry = response ? response.status === 429 || response.status >= 500 : true;
      if (!retry) return response!;
      if (attempt >= RETRY_WAITS_MS.length) {
        if (response) return response;
        throw failure instanceof Error ? failure : new Error(`Token Factory could not be reached (${String(failure)}).`);
      }
      await sleep(retryAfterMs(response) ?? RETRY_WAITS_MS[attempt]!, signal);
    }
  }
}

/** Haiku takes no effort setting; the larger Claude models do. */
function effortFor(model: string): { effort?: "medium" } {
  return /haiku/i.test(model) ? {} : { effort: "medium" };
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

/** The provider's own words for a failed call, cut short, or the status text. */
async function errorReason(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { error?: { message?: string } | string };
    const message = typeof data.error === "string" ? data.error : data.error?.message;
    if (message) return message.slice(0, 200);
  } catch {
    // Not JSON: the status text is all there is.
  }
  return response.statusText || "no detail";
}

function retryAfterMs(response: Response | null): number | null {
  const header = response?.headers.get("retry-after");
  if (!header) return null;
  const seconds = Number.parseFloat(header);
  return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : null;
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason instanceof Error ? signal.reason : new Error("The call was cancelled."));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Pulls the first JSON object out of a reply, dropping think tags, code fences and reasoning preambles. */
export function extractJson(text: string): unknown {
  const trimmed = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
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
