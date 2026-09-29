import OpenAI from "openai";
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
  user: string;
  schema: z.ZodType<T>;
  /** JSON schema for the provider; derived from the zod schema by the caller. */
  jsonSchema: Record<string, unknown>;
  schemaName: string;
  maxOutputTokens?: number;
  temperature?: number;
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
  signal?: AbortSignal;
}

export class BudgetExceededError extends Error {
  override name = "BudgetExceededError";
}

/**
 * The one door to Token Factory. Every call is traced (when LangSmith is on),
 * counted against the scan budget, and priced into the usage ledger.
 */
export class ModelClient {
  private readonly openai: OpenAI;
  private inputSpent = 0;

  constructor(
    private readonly config: EngineConfig,
    private readonly options: {
      onUsage?: UsageSink;
      maxInputTokens?: number;
      traceMetadata?: Record<string, string>;
    } = {},
  ) {
    const raw = new OpenAI({
      apiKey: config.tokenFactory.apiKey,
      baseURL: config.tokenFactory.baseUrl,
      maxRetries: 3,
      timeout: 180_000,
    });
    this.openai = config.langsmith.enabled ? wrapOpenAI(raw, { metadata: options.traceMetadata ?? {} }) : raw;
  }

  modelId(tier: ModelTier, fast = false): string {
    const base = this.config.models[tier];
    return fast ? `${base}-fast` : base;
  }

  get inputTokensSpent(): number {
    return this.inputSpent;
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

  private async record(model: string, purpose: string, usage: { prompt_tokens?: number; completion_tokens?: number } | undefined): Promise<void> {
    const inputTokens = usage?.prompt_tokens ?? 0;
    const outputTokens = usage?.completion_tokens ?? 0;
    this.inputSpent += inputTokens;
    const baseId = model.endsWith("-fast") ? model.slice(0, -5) : model;
    const price = this.config.prices[baseId] ?? { input: 0, output: 0 };
    const costMicrodollars = Math.round((inputTokens * price.input + outputTokens * price.output) / 1_000_000);
    await this.options.onUsage?.({ model, inputTokens, outputTokens, costMicrodollars, purpose });
  }

  /**
   * Structured completion. The schema goes to the provider as json_schema and
   * is repeated in the prompt, which the Token Factory docs recommend. The
   * result is validated with zod; one repair attempt follows a bad parse.
   */
  async complete<T>(opts: CompleteOptions<T>): Promise<T> {
    const model = this.modelId(opts.tier, opts.fast ?? false);
    const schemaText = JSON.stringify(opts.jsonSchema);
    const system = `${opts.system}\n\nRespond with a single JSON object that follows this JSON schema exactly, with no prose before or after:\n${schemaText}`;
    this.assertBudget(ModelClient.estimateTokens(system + opts.user));

    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      const messages: OpenAI.ChatCompletionMessageParam[] = [
        { role: "system", content: system },
        { role: "user", content: opts.user },
      ];
      if (attempt > 0 && lastError instanceof Error) {
        messages.push({
          role: "user",
          content: `The previous answer did not match the schema: ${lastError.message.slice(0, 500)}. Answer again with valid JSON only.`,
        });
      }
      const response = await this.openai.chat.completions.create(
        {
          model,
          messages,
          temperature: opts.temperature ?? 0.1,
          max_tokens: opts.maxOutputTokens ?? 4096,
          response_format: {
            type: "json_schema",
            json_schema: { name: opts.schemaName, schema: opts.jsonSchema, strict: false },
          },
        },
        { signal: opts.signal ?? null },
      );
      await this.record(model, opts.purpose, response.usage ?? undefined);
      const content = response.choices[0]?.message?.content ?? "";
      try {
        const parsed = opts.schema.parse(extractJson(content));
        return parsed;
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(`Model output did not match the expected shape for ${opts.purpose}: ${String(lastError)}`);
  }

  /** Free-text completion, used by chat and explanations. */
  async text(opts: TextOptions): Promise<string> {
    const model = this.modelId(opts.tier, opts.fast ?? false);
    const joined = opts.system + opts.messages.map((m) => m.content).join("\n");
    this.assertBudget(ModelClient.estimateTokens(joined));
    const response = await this.openai.chat.completions.create(
      {
        model,
        messages: [{ role: "system", content: opts.system }, ...opts.messages],
        temperature: opts.temperature ?? 0.3,
        max_tokens: opts.maxOutputTokens ?? 2048,
      },
      { signal: opts.signal ?? null },
    );
    await this.record(model, opts.purpose, response.usage ?? undefined);
    return response.choices[0]?.message?.content?.trim() ?? "";
  }

  async embed(inputs: string[], purpose: string): Promise<number[][]> {
    if (inputs.length === 0) return [];
    const model = this.config.models.embedding;
    const response = await this.openai.embeddings.create({ model, input: inputs, encoding_format: "float" });
    await this.record(model, purpose, response.usage ?? undefined);
    return response.data
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);
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
