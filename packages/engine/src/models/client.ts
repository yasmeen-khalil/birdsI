import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import OpenAI from "openai";
import { traceable } from "langsmith/traceable";
import { wrapOpenAI } from "langsmith/wrappers/openai";
import type { z } from "zod";
import type { EngineConfig, ModelIds } from "../config";

export type ModelTier = keyof Omit<ModelIds, "embedding">;

export interface Usage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  costMicrodollars: number;
  purpose: string;
}

export type UsageSink = (usage: Usage) => void | Promise<void>;

export interface CompleteOptions<T> {
  tier: ModelTier;
  /** Interactive work uses the fast flavor; background work the base flavor. */
  fast?: boolean;
  purpose: string;
  system: string;
  /** Stable text shared by many calls in one scan (the repository digest, facts). Cached by the provider. */
  cachedContext?: string;
  user: string;
  schema: z.ZodType<T>;
  /** JSON schema for the provider; derived from the zod schema by the caller. */
  jsonSchema: Record<string, unknown>;
  schemaName: string;
  maxOutputTokens?: number;
  temperature?: number;
  /** How hard the model thinks, where the provider supports it. Defaults by tier. */
  effort?: "low" | "medium" | "high";
  signal?: AbortSignal;
}

export interface TextOptions {
  tier: ModelTier;
  fast?: boolean;
  purpose: string;
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  maxOutputTokens?: number;
  temperature?: number;
  effort?: "low" | "medium" | "high";
  signal?: AbortSignal;
}

export class BudgetExceededError extends Error {
  override name = "BudgetExceededError";
}

export class EmbeddingsUnavailableError extends Error {
  override name = "EmbeddingsUnavailableError";
}

interface RawUsage {
  inputTokens: number;
  outputTokens: number;
}

/** Effort by tier for the Claude models that take it. Haiku 4.5 takes none. */
const EFFORT_BY_TIER: Record<ModelTier, "low" | "medium" | "high"> = { nano: "low", super: "medium", ultra: "high" };

/**
 * The one door to the model provider. Every call is traced (when LangSmith
 * is on), counted against the scan budget, and priced into the usage ledger.
 * Claude (Anthropic) and Nemotron (Token Factory) sit behind the same calls.
 */
export class ModelClient {
  private readonly anthropic: Anthropic | null;
  private readonly openai: OpenAI | null;
  private inputSpent = 0;

  constructor(
    private readonly config: EngineConfig,
    private readonly options: {
      onUsage?: UsageSink;
      maxInputTokens?: number;
      traceMetadata?: Record<string, string>;
    } = {},
  ) {
    this.anthropic = config.anthropic.apiKey ? new Anthropic({ apiKey: config.anthropic.apiKey, maxRetries: 3, timeout: 300_000 }) : null;
    if (config.tokenFactory.apiKey) {
      const raw = new OpenAI({ apiKey: config.tokenFactory.apiKey, baseURL: config.tokenFactory.baseUrl, maxRetries: 3, timeout: 180_000 });
      this.openai = config.langsmith.enabled ? wrapOpenAI(raw, { metadata: options.traceMetadata ?? {} }) : raw;
    } else {
      this.openai = null;
    }
  }

  modelId(tier: ModelTier, fast = false): string {
    const base = this.config.models[tier];
    return this.config.provider === "nebius" && fast ? `${base}-fast` : base;
  }

  get inputTokensSpent(): number {
    return this.inputSpent;
  }

  get embeddingsAvailable(): boolean {
    return this.config.models.embedding !== null && this.openai !== null;
  }

  /** Rough token estimate for budgeting before a call is made. */
  static estimateTokens(text: string): number {
    return Math.ceil(text.length / 3.6);
  }

  private assertBudget(estimatedInput: number): void {
    const max = this.options.maxInputTokens;
    if (max !== undefined && this.inputSpent + estimatedInput > max) {
      throw new BudgetExceededError(
        `Scan budget reached (${this.inputSpent.toLocaleString()} of ${max.toLocaleString()} input tokens).`,
      );
    }
  }

  private async record(model: string, purpose: string, usage: RawUsage): Promise<void> {
    this.inputSpent += usage.inputTokens;
    const baseId = model.endsWith("-fast") ? model.slice(0, -5) : model;
    const price = this.config.prices[baseId] ?? { input: 0, output: 0 };
    const costMicrodollars = Math.round((usage.inputTokens * price.input + usage.outputTokens * price.output) / 1_000_000);
    await this.options.onUsage?.({ model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costMicrodollars, purpose });
  }

  /** Wraps a provider call in a LangSmith trace when tracing is on. */
  private traced<A extends unknown[], R>(name: string, fn: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
    if (!this.config.langsmith.enabled) return fn;
    return traceable(fn, { name, run_type: "llm", project_name: this.config.langsmith.project, metadata: this.options.traceMetadata ?? {} }) as unknown as (...args: A) => Promise<R>;
  }

  /**
   * Structured completion. The schema is enforced by the provider (Claude's
   * structured outputs, or Token Factory's json_schema response format) and
   * validated again with zod; one repair attempt follows a bad parse.
   */
  async complete<T>(opts: CompleteOptions<T>): Promise<T> {
    const model = this.modelId(opts.tier, opts.fast ?? false);
    const schemaText = JSON.stringify(opts.jsonSchema);
    const system = `${opts.system}\n\nRespond with a single JSON object that follows this JSON schema exactly, with no prose before or after:\n${schemaText}`;
    this.assertBudget(ModelClient.estimateTokens(system + (opts.cachedContext ?? "") + opts.user));

    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      const repair = attempt > 0 && lastError instanceof Error ? `The previous answer did not match the schema: ${lastError.message.slice(0, 500)}. Answer again with valid JSON only, and keep every text field short so the whole answer fits.` : null;
      const { text, usage } = await this.traced(`${opts.purpose}:${model}`, () => this.completeRaw(model, opts, system, repair))();
      await this.record(model, opts.purpose, usage);
      try {
        return opts.schema.parse(extractJson(text));
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(`Model output did not match the expected shape for ${opts.purpose}: ${String(lastError)}`);
  }

  private async completeRaw<T>(model: string, opts: CompleteOptions<T>, system: string, repair: string | null): Promise<{ text: string; usage: RawUsage }> {
    if (this.config.provider === "anthropic") {
      const client = this.requireAnthropic();
      const messages: Anthropic.MessageParam[] = [{ role: "user", content: opts.user }];
      if (repair) messages.push({ role: "user", content: repair });
      // The system text and the shared context are the stable prefix; the provider caches them across the scan's calls.
      const systemBlocks: Anthropic.TextBlockParam[] = [{ type: "text", text: system, cache_control: { type: "ephemeral" } }];
      if (opts.cachedContext) systemBlocks.push({ type: "text", text: opts.cachedContext, cache_control: { type: "ephemeral" } });
      const params = {
        model,
        max_tokens: opts.maxOutputTokens ?? 4096,
        system: systemBlocks,
        messages,
        output_config: { format: zodOutputFormat(opts.schema as never), ...(this.effortFor(model, opts.tier, opts.effort)) },
      };
      try {
        const response = await client.messages.parse(params, { signal: opts.signal ?? undefined });
        assertNotRefused(response, opts.purpose);
        const usage = usageOf(response);
        if (response.parsed_output !== null && response.parsed_output !== undefined) {
          return { text: JSON.stringify(response.parsed_output), usage };
        }
        return { text: textOf(response), usage };
      } catch (error) {
        // The SDK could not parse the reply (usually cut off at max_tokens). Read the raw text
        // instead; the caller's repair attempt asks for a shorter answer.
        if (!(error instanceof Error) || !/parse structured output/i.test(error.message)) throw error;
        const response = await client.messages.create(params, { signal: opts.signal ?? undefined });
        assertNotRefused(response, opts.purpose);
        const text = textOf(response);
        return { text: response.stop_reason === "max_tokens" ? `${text}\n` : text, usage: usageOf(response) };
      }
    }
    const client = this.requireOpenAI();
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: "system", content: opts.cachedContext ? `${system}\n\n${opts.cachedContext}` : system },
      { role: "user", content: opts.user },
    ];
    if (repair) messages.push({ role: "user", content: repair });
    const response = await client.chat.completions.create(
      {
        model,
        messages,
        temperature: opts.temperature ?? 0.1,
        max_tokens: opts.maxOutputTokens ?? 4096,
        response_format: { type: "json_schema", json_schema: { name: opts.schemaName, schema: opts.jsonSchema, strict: false } },
      },
      { signal: opts.signal ?? null },
    );
    return { text: response.choices[0]?.message?.content ?? "", usage: { inputTokens: response.usage?.prompt_tokens ?? 0, outputTokens: response.usage?.completion_tokens ?? 0 } };
  }

  /** Free-text completion, used by chat and explanations. */
  async text(opts: TextOptions): Promise<string> {
    const model = this.modelId(opts.tier, opts.fast ?? false);
    const joined = opts.system + opts.messages.map((m) => m.content).join("\n");
    this.assertBudget(ModelClient.estimateTokens(joined));
    const { text, usage } = await this.traced(`${opts.purpose}:${model}`, async () => {
      if (this.config.provider === "anthropic") {
        const client = this.requireAnthropic();
        const response = await client.messages.create(
          {
            model,
            max_tokens: opts.maxOutputTokens ?? 2048,
            system: opts.system,
            messages: opts.messages.map((m) => ({ role: m.role, content: m.content })),
            ...(Object.keys(this.effortFor(model, opts.tier, opts.effort)).length > 0 ? { output_config: this.effortFor(model, opts.tier, opts.effort) } : {}),
          },
          { signal: opts.signal ?? undefined },
        );
        assertNotRefused(response, opts.purpose);
        return { text: textOf(response), usage: usageOf(response) };
      }
      const client = this.requireOpenAI();
      const response = await client.chat.completions.create(
        {
          model,
          messages: [{ role: "system", content: opts.system }, ...opts.messages],
          temperature: opts.temperature ?? 0.3,
          max_tokens: opts.maxOutputTokens ?? 2048,
        },
        { signal: opts.signal ?? null },
      );
      return { text: response.choices[0]?.message?.content?.trim() ?? "", usage: { inputTokens: response.usage?.prompt_tokens ?? 0, outputTokens: response.usage?.completion_tokens ?? 0 } };
    })();
    await this.record(model, opts.purpose, usage);
    return text.trim();
  }

  /** Embeddings come from Token Factory; without its key, callers fall back to keyword retrieval. */
  async embed(inputs: string[], purpose: string): Promise<number[][]> {
    if (inputs.length === 0) return [];
    const model = this.config.models.embedding;
    if (!model || !this.openai) throw new EmbeddingsUnavailableError("No embedding model is configured. Add NEBIUS_API_KEY to enable embeddings; chat uses keyword retrieval without them.");
    const response = await this.openai.embeddings.create({ model, input: inputs, encoding_format: "float" });
    await this.record(model, purpose, { inputTokens: response.usage?.prompt_tokens ?? 0, outputTokens: 0 });
    return response.data
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);
  }

  private requireAnthropic(): Anthropic {
    if (!this.anthropic) throw new Error("ANTHROPIC_API_KEY is not set.");
    return this.anthropic;
  }

  private requireOpenAI(): OpenAI {
    if (!this.openai) throw new Error("NEBIUS_API_KEY is not set.");
    return this.openai;
  }

  /** Haiku takes no effort setting; the Opus and Fable tiers do. */
  private effortFor(model: string, tier: ModelTier, effort?: "low" | "medium" | "high"): { effort?: "low" | "medium" | "high" } {
    if (/haiku/i.test(model)) return {};
    return { effort: effort ?? EFFORT_BY_TIER[tier] };
  }
}

function usageOf(response: Anthropic.Message): RawUsage {
  const cached = (response.usage.cache_read_input_tokens ?? 0) + (response.usage.cache_creation_input_tokens ?? 0);
  return { inputTokens: response.usage.input_tokens + cached, outputTokens: response.usage.output_tokens };
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
