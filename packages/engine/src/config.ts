import type { ScanKind } from "@birdsi/shared";

/**
 * Engine configuration, read once from the environment by the process that
 * hosts the engine (worker or web). Every model id is overridable so a
 * catalogue rename never needs a code change.
 *
 * Two providers sit behind the same door: Claude through the Anthropic API,
 * and Nemotron through Nebius Token Factory. ANTHROPIC_API_KEY selects
 * Claude; otherwise NEBIUS_API_KEY selects Nemotron. BIRDSI_PROVIDER forces
 * one when both keys exist.
 */
export type Provider = "anthropic" | "nebius";

export interface ModelIds {
  nano: string;
  super: string;
  ultra: string;
  /** Null when no embedding model is reachable; chat then uses keyword retrieval. */
  embedding: string | null;
}

export interface EngineConfig {
  provider: Provider;
  anthropic: {
    apiKey: string | null;
  };
  tokenFactory: {
    apiKey: string | null;
    baseUrl: string;
    /** Sandboxes need a project id in addition to the API key. */
    projectId: string | null;
    sandboxBaseUrl: string;
  };
  models: ModelIds;
  tavilyApiKey: string | null;
  langsmith: {
    enabled: boolean;
    project: string;
  };
  github: {
    appId: string | null;
    privateKey: string | null;
    appSlug: string | null;
  };
  /** Per-scan ceilings by tier, in whole tokens and microdollars. */
  budgets: Record<ScanKind, ScanBudget>;
  /** Approximate prices used for the usage ledger, per million tokens, in microdollars. */
  prices: Record<string, { input: number; output: number }>;
}

export interface ScanBudget {
  /** Files the model may read in full. */
  maxFilesRead: number;
  /** Bytes of a single file the model may read; larger files are windowed. */
  maxFileBytes: number;
  /** Total model input tokens the scan may spend. */
  maxInputTokens: number;
  /** Dependencies checked against current docs through Tavily. */
  maxDocsChecks: number;
  /** Which model reads code in this tier. */
  reviewModel: keyof Omit<ModelIds, "embedding">;
  /** Which model does the cross-file pass, if any. */
  crosscheckModel: keyof Omit<ModelIds, "embedding"> | null;
  /** Whether the pre-launch audit areas run. */
  audit: boolean;
  /** Use the fast flavor for the review model (interactive tiers). */
  fast: boolean;
  /** Model calls in flight at once while reading files and checking docs. */
  concurrency: number;
}

const NEBIUS_MODELS = {
  nano: "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B",
  super: "nvidia/nemotron-3-super-120b-a12b",
  ultra: "nvidia/Nemotron-3-Ultra-550b-a55b",
  embedding: "Qwen/Qwen3-Embedding-8B",
} as const;

const ANTHROPIC_MODELS = {
  nano: "claude-haiku-4-5",
  super: "claude-opus-5-5",
  ultra: "claude-fable-5-1",
} as const;

/** Microdollars per million tokens: $0.06 = 60,000 microdollars. */
const DEFAULT_PRICES: EngineConfig["prices"] = {
  [NEBIUS_MODELS.nano]: { input: 60_000, output: 240_000 },
  [NEBIUS_MODELS.super]: { input: 300_000, output: 900_000 },
  [NEBIUS_MODELS.ultra]: { input: 1_000_000, output: 3_000_000 },
  [NEBIUS_MODELS.embedding]: { input: 10_000, output: 0 },
  [ANTHROPIC_MODELS.nano]: { input: 1_000_000, output: 5_000_000 },
  [ANTHROPIC_MODELS.super]: { input: 4_000_000, output: 20_000_000 },
  [ANTHROPIC_MODELS.ultra]: { input: 10_000_000, output: 50_000_000 },
};

const DEFAULT_BUDGETS: Record<ScanKind, ScanBudget> = {
  light: {
    maxFilesRead: 40,
    maxFileBytes: 24_000,
    maxInputTokens: 400_000,
    maxDocsChecks: 6,
    reviewModel: "nano",
    crosscheckModel: null,
    audit: false,
    fast: true,
    concurrency: 4,
  },
  deep: {
    maxFilesRead: 400,
    maxFileBytes: 48_000,
    maxInputTokens: 3_000_000,
    maxDocsChecks: 20,
    reviewModel: "super",
    crosscheckModel: "super",
    audit: false,
    fast: false,
    concurrency: 3,
  },
  audit: {
    maxFilesRead: 600,
    maxFileBytes: 64_000,
    maxInputTokens: 6_000_000,
    maxDocsChecks: 30,
    reviewModel: "super",
    crosscheckModel: "ultra",
    audit: true,
    fast: false,
    concurrency: 3,
  },
};

function env(name: string): string | null {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : null;
}

function envInt(name: string, fallback: number): number {
  const raw = env(name);
  if (raw === null) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Which provider the environment selects, or null when no model key is set. */
export function detectProvider(): Provider | null {
  const forced = env("BIRDSI_PROVIDER");
  if (forced === "anthropic" || forced === "nebius") return forced;
  if (env("ANTHROPIC_API_KEY")) return "anthropic";
  if (env("NEBIUS_API_KEY")) return "nebius";
  return null;
}

/**
 * Builds the config from the environment. Throws only when no model key is
 * set at all; every other integration degrades to "off" with a clear note so
 * the product stays usable while accounts are being set up.
 */
export function loadEngineConfig(overrides: Partial<EngineConfig> = {}): EngineConfig {
  const provider = detectProvider();
  if (!provider) {
    throw new Error("No model key is set. Add ANTHROPIC_API_KEY (Claude) or NEBIUS_API_KEY (Nemotron on Token Factory) to .env.local or the hosting environment.");
  }
  const anthropicKey = env("ANTHROPIC_API_KEY");
  const nebiusKey = env("NEBIUS_API_KEY");
  if (provider === "anthropic" && !anthropicKey) throw new Error("BIRDSI_PROVIDER is anthropic but ANTHROPIC_API_KEY is not set.");
  if (provider === "nebius" && !nebiusKey) throw new Error("BIRDSI_PROVIDER is nebius but NEBIUS_API_KEY is not set.");

  const base = provider === "anthropic" ? ANTHROPIC_MODELS : NEBIUS_MODELS;
  const models: ModelIds = {
    nano: env("BIRDSI_MODEL_NANO") ?? base.nano,
    super: env("BIRDSI_MODEL_SUPER") ?? base.super,
    ultra: env("BIRDSI_MODEL_ULTRA") ?? base.ultra,
    // Claude has no embedding model; Token Factory's embeddings are used when its key exists.
    embedding: env("BIRDSI_MODEL_EMBEDDING") ?? (nebiusKey ? NEBIUS_MODELS.embedding : null),
  };
  const prices: EngineConfig["prices"] = { ...DEFAULT_PRICES };
  for (const key of ["nano", "super", "ultra"] as const) {
    const id = models[key];
    if (!prices[id]) prices[id] = DEFAULT_PRICES[base[key]]!;
  }
  if (models.embedding && !prices[models.embedding]) prices[models.embedding] = DEFAULT_PRICES[NEBIUS_MODELS.embedding]!;

  const budgets: Record<ScanKind, ScanBudget> = {
    light: { ...DEFAULT_BUDGETS.light, maxInputTokens: envInt("BIRDSI_BUDGET_LIGHT_TOKENS", DEFAULT_BUDGETS.light.maxInputTokens), concurrency: envInt("BIRDSI_SCAN_CONCURRENCY", DEFAULT_BUDGETS.light.concurrency) },
    deep: { ...DEFAULT_BUDGETS.deep, maxInputTokens: envInt("BIRDSI_BUDGET_DEEP_TOKENS", DEFAULT_BUDGETS.deep.maxInputTokens), concurrency: envInt("BIRDSI_SCAN_CONCURRENCY", DEFAULT_BUDGETS.deep.concurrency) },
    audit: { ...DEFAULT_BUDGETS.audit, maxInputTokens: envInt("BIRDSI_BUDGET_AUDIT_TOKENS", DEFAULT_BUDGETS.audit.maxInputTokens), concurrency: envInt("BIRDSI_SCAN_CONCURRENCY", DEFAULT_BUDGETS.audit.concurrency) },
  };

  return {
    provider,
    anthropic: { apiKey: anthropicKey },
    tokenFactory: {
      apiKey: nebiusKey,
      baseUrl: env("NEBIUS_BASE_URL") ?? "https://api.tokenfactory.nebius.com/v1/",
      projectId: env("NEBIUS_AI_PROJECT"),
      sandboxBaseUrl: env("NEBIUS_SANDBOX_URL") ?? "https://api.tokenfactory.nebius.com/sandboxes/v1",
    },
    models,
    tavilyApiKey: env("TAVILY_API_KEY"),
    langsmith: {
      enabled: env("LANGSMITH_TRACING") === "true" && env("LANGSMITH_API_KEY") !== null,
      project: env("LANGSMITH_PROJECT") ?? "birdsi",
    },
    github: {
      appId: env("GITHUB_APP_ID"),
      privateKey: env("GITHUB_APP_PRIVATE_KEY")?.replace(/\\n/g, "\n") ?? null,
      appSlug: env("GITHUB_APP_SLUG"),
    },
    budgets,
    prices,
    ...overrides,
  };
}

export { NEBIUS_MODELS, ANTHROPIC_MODELS, DEFAULT_BUDGETS, DEFAULT_PRICES };
/** Kept for callers that referenced the old name. */
export const DEFAULT_MODELS = NEBIUS_MODELS;
