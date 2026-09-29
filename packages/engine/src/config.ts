import type { ScanKind } from "@birdsi/shared";

/**
 * Engine configuration, read once from the environment by the process that
 * hosts the engine (worker or web). Every model id is overridable so a
 * catalogue rename never needs a code change.
 */
export interface ModelIds {
  nano: string;
  super: string;
  ultra: string;
  embedding: string;
}

export interface EngineConfig {
  tokenFactory: {
    apiKey: string;
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
}

const DEFAULT_MODELS: ModelIds = {
  nano: "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B",
  super: "nvidia/nemotron-3-super-120b-a12b",
  ultra: "nvidia/Nemotron-3-Ultra-550b-a55b",
  embedding: "Qwen/Qwen3-Embedding-8B",
};

/** Microdollars per million tokens: $0.06 = 60,000 microdollars. */
const DEFAULT_PRICES: EngineConfig["prices"] = {
  [DEFAULT_MODELS.nano]: { input: 60_000, output: 240_000 },
  [DEFAULT_MODELS.super]: { input: 300_000, output: 900_000 },
  [DEFAULT_MODELS.ultra]: { input: 1_000_000, output: 3_000_000 },
  [DEFAULT_MODELS.embedding]: { input: 10_000, output: 0 },
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

/**
 * Builds the config from the environment. Throws only for the one key without
 * which nothing works; every other integration degrades to "off" with a clear
 * note so the product stays usable while accounts are being set up.
 */
export function loadEngineConfig(overrides: Partial<EngineConfig> = {}): EngineConfig {
  const apiKey = env("NEBIUS_API_KEY");
  if (!apiKey) {
    throw new Error("NEBIUS_API_KEY is not set. Add it to .env.local (local) or the hosting environment.");
  }
  const models: ModelIds = {
    nano: env("BIRDSI_MODEL_NANO") ?? DEFAULT_MODELS.nano,
    super: env("BIRDSI_MODEL_SUPER") ?? DEFAULT_MODELS.super,
    ultra: env("BIRDSI_MODEL_ULTRA") ?? DEFAULT_MODELS.ultra,
    embedding: env("BIRDSI_MODEL_EMBEDDING") ?? DEFAULT_MODELS.embedding,
  };
  const prices: EngineConfig["prices"] = { ...DEFAULT_PRICES };
  for (const key of ["nano", "super", "ultra", "embedding"] as const) {
    const id = models[key];
    if (!prices[id]) prices[id] = DEFAULT_PRICES[DEFAULT_MODELS[key]]!;
  }

  const budgets: Record<ScanKind, ScanBudget> = {
    light: { ...DEFAULT_BUDGETS.light, maxInputTokens: envInt("BIRDSI_BUDGET_LIGHT_TOKENS", DEFAULT_BUDGETS.light.maxInputTokens) },
    deep: { ...DEFAULT_BUDGETS.deep, maxInputTokens: envInt("BIRDSI_BUDGET_DEEP_TOKENS", DEFAULT_BUDGETS.deep.maxInputTokens) },
    audit: { ...DEFAULT_BUDGETS.audit, maxInputTokens: envInt("BIRDSI_BUDGET_AUDIT_TOKENS", DEFAULT_BUDGETS.audit.maxInputTokens) },
  };

  return {
    tokenFactory: {
      apiKey,
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

export { DEFAULT_MODELS, DEFAULT_BUDGETS, DEFAULT_PRICES };
