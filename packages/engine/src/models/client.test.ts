import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DEFAULT_BUDGET, type EngineConfig } from "../config";
import { extractJson, ModelClient, type Usage } from "./client";

function config(overrides: Partial<EngineConfig> = {}): EngineConfig {
  return {
    provider: "nebius",
    anthropic: { apiKey: null },
    tokenFactory: { apiKey: "test-key", baseUrl: "https://example.test/v1/" },
    models: { nano: "small", super: "large" },
    tavilyApiKey: null,
    reader: { enabled: true },
    github: { appId: null, privateKey: null, appSlug: null },
    budget: DEFAULT_BUDGET,
    prices: {
      small: { input: 60_000, cachedInput: 12_000, output: 240_000 },
      large: { input: 300_000, cachedInput: 60_000, output: 900_000 },
    },
    ...overrides,
  };
}

interface ReplyOptions {
  finishReason?: string;
  /** Text the provider put in the message's reasoning field. */
  reasoning?: string;
  promptTokens?: number;
  completionTokens?: number;
  cachedTokens?: number;
}

function reply(content: string, options: ReplyOptions = {}): Response {
  const body = {
    choices: [{ message: { content, ...(options.reasoning !== undefined ? { reasoning: options.reasoning } : {}) }, finish_reason: options.finishReason ?? "stop" }],
    usage: {
      prompt_tokens: options.promptTokens ?? 100,
      completion_tokens: options.completionTokens ?? 10,
      prompt_tokens_details: { cached_tokens: options.cachedTokens ?? 0 },
    },
  };
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

function failure(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: { type: "error", message } }), { status, headers: { "content-type": "application/json", "retry-after": "0" } });
}

const Answer = z.object({ ok: z.boolean() });
const ANSWER_SCHEMA = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] };

interface Call {
  url: string;
  headers: Record<string, string>;
  body: { model: string; messages: Array<{ role: string; content: string }>; response_format: { type: string; json_schema?: { name: string } }; chat_template_kwargs?: { enable_thinking: boolean } };
}

function fakeFetch(responses: Response[]): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const queue = [...responses];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string>, body: JSON.parse(String(init?.body)) as Call["body"] });
    const next = queue.shift();
    if (!next) throw new Error("no response left");
    return next;
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}

function ask(client: ModelClient, tier?: "nano" | "super", thinking?: boolean): Promise<{ ok: boolean }> {
  return client.complete({ ...(tier ? { tier } : {}), ...(thinking !== undefined ? { thinking } : {}), purpose: "test", system: "Answer the question.", user: "Is it ok?", schema: Answer, jsonSchema: ANSWER_SCHEMA, schemaName: "answer" });
}

describe("ModelClient on Token Factory", () => {
  it("sends the schema with the key and prices cached tokens at the cached price", async () => {
    const { fetch, calls } = fakeFetch([reply('{"ok":true}', { promptTokens: 1100, cachedTokens: 1000, completionTokens: 10 })]);
    const usages: Usage[] = [];
    const client = new ModelClient(config(), { fetch, onUsage: (u) => void usages.push(u) });
    expect(client.available).toBe(true);
    await expect(ask(client)).resolves.toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe("https://example.test/v1/chat/completions");
    expect(call.headers["authorization"]).toBe("Bearer test-key");
    expect(call.body.model).toBe("small");
    expect(call.body.response_format).toEqual({ type: "json_schema", json_schema: { name: "answer", schema: ANSWER_SCHEMA } });
    expect(call.body.messages[0]!.content).toContain("JSON schema");
    expect(call.body.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(usages).toEqual([{ model: "small", inputTokens: 1100, cachedTokens: 1000, outputTokens: 10, costMicrodollars: 20, purpose: "test" }]);
    expect(client.inputTokensSpent).toBe(1100);
  });

  it("uses the large model for the super tier", async () => {
    const { fetch, calls } = fakeFetch([reply('{"ok":true}')]);
    await ask(new ModelClient(config(), { fetch }), "super");
    expect(calls[0]!.body.model).toBe("large");
  });

  it("retries a slow-down answer and counts it", async () => {
    const { fetch, calls } = fakeFetch([failure(429, "slow down"), reply('{"ok":true}')]);
    const client = new ModelClient(config(), { fetch });
    await expect(ask(client)).resolves.toEqual({ ok: true });
    expect(calls).toHaveLength(2);
    expect(client.throttledCalls).toBe(1);
  });

  it("gives up after the retries with the provider's own words", async () => {
    const { fetch } = fakeFetch([failure(500, "upstream down"), failure(500, "upstream down"), failure(500, "upstream down"), failure(500, "upstream down")]);
    await expect(ask(new ModelClient(config(), { fetch }))).rejects.toThrow("Token Factory answered 500 for test: upstream down");
  });

  it("answers in plain JSON mode when a model refuses the schema format, and remembers it", async () => {
    const { fetch, calls } = fakeFetch([failure(400, "response_format json_schema is not supported for this model"), reply('{"ok":true}'), reply('{"ok":false}')]);
    const client = new ModelClient(config(), { fetch });
    await expect(ask(client)).resolves.toEqual({ ok: true });
    await expect(ask(client)).resolves.toEqual({ ok: false });
    expect(calls.map((c) => c.body.response_format.type)).toEqual(["json_schema", "json_object", "json_object"]);
  });

  it("leaves thinking on for a call that asks for it", async () => {
    const { fetch, calls } = fakeFetch([reply('{"ok":true}')]);
    await ask(new ModelClient(config(), { fetch }), undefined, true);
    expect(calls[0]!.body.chat_template_kwargs).toBeUndefined();
  });

  it("fails at once, without asking again, when a thinking call is cut off at the output limit", async () => {
    const { fetch, calls } = fakeFetch([reply("", { finishReason: "length" }), reply('{"ok":true}')]);
    await expect(ask(new ModelClient(config(), { fetch }), undefined, true)).rejects.toMatchObject({ name: "OutputLimitError" });
    expect(calls).toHaveLength(1);
  });

  it("calls without the thinking switch once a model refuses it, and remembers it", async () => {
    const { fetch, calls } = fakeFetch([failure(400, "chat_template_kwargs: enable_thinking is not a template variable"), reply('{"ok":true}'), reply('{"ok":false}')]);
    const client = new ModelClient(config(), { fetch });
    await expect(ask(client)).resolves.toEqual({ ok: true });
    await expect(ask(client)).resolves.toEqual({ ok: false });
    expect(calls.map((c) => c.body.chat_template_kwargs)).toEqual([{ enable_thinking: false }, undefined, undefined]);
    expect(calls.map((c) => c.body.response_format.type)).toEqual(["json_schema", "json_schema", "json_schema"]);
  });

  it("reads an answer the provider put in the reasoning field", async () => {
    const { fetch } = fakeFetch([reply("", { reasoning: '{"ok":true}' })]);
    await expect(ask(new ModelClient(config(), { fetch }))).resolves.toEqual({ ok: true });
  });

  it("asks again when the answer does not match the schema", async () => {
    const { fetch, calls } = fakeFetch([reply('{"ok":"yes"}'), reply('{"ok":true}')]);
    await expect(ask(new ModelClient(config(), { fetch }))).resolves.toEqual({ ok: true });
    expect(calls).toHaveLength(2);
    const repair = calls[1]!.body.messages.at(-1)!;
    expect(repair.role).toBe("user");
    expect(repair.content).toContain("did not match the schema");
  });

  it("asks again shorter when the answer stopped at the output limit", async () => {
    const { fetch, calls } = fakeFetch([reply('{"ok":tr', { finishReason: "length" }), reply('{"ok":true}')]);
    await expect(ask(new ModelClient(config(), { fetch }))).resolves.toEqual({ ok: true });
    expect(calls[1]!.body.messages.at(-1)!.content).toContain("output limit");
  });

  it("refuses to call without a model key", async () => {
    const client = new ModelClient(config({ provider: null, tokenFactory: { apiKey: null, baseUrl: "https://example.test/v1/" } }));
    expect(client.available).toBe(false);
    await expect(ask(client)).rejects.toThrow("No model key is set");
  });

  it("stops before a call once the budget is spent", async () => {
    const { fetch, calls } = fakeFetch([reply('{"ok":true}')]);
    const client = new ModelClient(config(), { fetch, maxInputTokens: 10 });
    await expect(ask(client)).rejects.toThrow("Scan budget reached");
    expect(calls).toHaveLength(0);
  });
});

describe("extractJson", () => {
  it("parses plain JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("parses fenced JSON and reasoning preambles", () => {
    expect(extractJson('Here you go:\n```json\n{"a": [1,2]}\n```')).toEqual({ a: [1, 2] });
    expect(extractJson('Thinking... the answer is {"ok": true} and that is all.')).toEqual({ ok: true });
  });

  it("drops think tags before reading the answer", () => {
    expect(extractJson('<think>maybe {"ok": false}? no</think>\n{"ok": true}')).toEqual({ ok: true });
  });

  it("throws when there is no object", () => {
    expect(() => extractJson("no json here")).toThrow();
  });
});

describe("ModelClient.estimateTokens", () => {
  it("scales with length", () => {
    expect(ModelClient.estimateTokens("")).toBe(0);
    expect(ModelClient.estimateTokens("a".repeat(360))).toBe(100);
  });
});

