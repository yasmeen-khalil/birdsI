/**
 * Engine configuration, read once from the environment by the process that
 * hosts the engine (worker or web). Never throws: every integration degrades
 * to "off" with a note, so the product stays usable while keys are set up.
 *
 * Two providers sit behind one door: Nemotron on Nebius Token Factory, and
 * Claude through the Anthropic API. NEBIUS_API_KEY selects Nemotron, otherwise
 * ANTHROPIC_API_KEY selects Claude, and BIRDSI_PROVIDER picks one when both
 * keys exist. With no model key, nothing that needs a model runs.
 */
export type Provider = "anthropic" | "nebius";

/** Two sizes of model: nano reads and answers everyday calls, super verifies and judges. */
export type ModelTier = "nano" | "super";

/** Per million tokens, in microdollars: $1 is 1,000,000. */
export interface ModelPrice {
  input: number;
  /** Prompt tokens the provider served from its cache. */
  cachedInput: number;
  output: number;
}

export interface EngineConfig {
  /** Null when no model key is set: the map runs without the docs check. */
  provider: Provider | null;
  anthropic: {
    apiKey: string | null;
  };
  tokenFactory: {
    apiKey: string | null;
    /** Ends with a slash, so "chat/completions" resolves under it. */
    baseUrl: string;
  };
  models: Record<ModelTier, string>;
  tavilyApiKey: string | null;
  github: {
    appId: string | null;
    privateKey: string | null;
    appSlug: string | null;
  };
  reader: {
    /** The model's reading of the code after the rules. Off with BIRDSI_READER=off. */
    enabled: boolean;
  };
  /** Ceilings for one map of the code. */
  budget: ScanBudget;
  /** Prices for the usage ledger, by model id. */
  prices: Record<string, ModelPrice>;
}

export interface ScanBudget {
  /** Code files searched for how a package is imported, in priority order. */
  maxFilesRead: number;
  /** Bytes of a single file that are read; larger files are windowed. */
  maxFileBytes: number;
  /** Total model input tokens the docs check may spend in one map. */
  maxInputTokens: number;
  /** Dependencies checked against their current docs. */
  maxDocsChecks: number;
  /** Docs checks in flight at once. */
  concurrency: number;
  /** Input tokens the model's reading of the code may spend in one map. */
  maxReadTokens: number;
  /** Reading calls in flight at once. */
  readConcurrency: number;
}

/** Token Factory ids, from its model catalog (read 2026-10-27). */
export const NEBIUS_MODELS: Record<ModelTier, string> = {
  nano: "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B",
  super: "nvidia/nemotron-3-super-120b-a12b",
};

export const ANTHROPIC_MODELS: Record<ModelTier, string> = {
  nano: "claude-haiku-4-5",
  super: "claude-opus-5-5",
};

const TOKEN_FACTORY_URL = "https://api.tokenfactory.nebius.com/v1/";

/** Catalog prices on 2026-10-27, in microdollars per million tokens. */
export const DEFAULT_PRICES: Record<string, ModelPrice> = {
  [NEBIUS_MODELS.nano]: { input: 60_000, cachedInput: 12_000, output: 240_000 },
  [NEBIUS_MODELS.super]: { input: 300_000, cachedInput: 60_000, output: 900_000 },
  "nvidia/Nemotron-3_5-Lightning": { input: 60_000, cachedInput: 30_000, output: 240_000 },
  "nvidia/Nemotron-3-Ultra-550b-a55b": { input: 1_000_000, cachedInput: 120_000, output: 3_000_000 },
  [ANTHROPIC_MODELS.nano]: { input: 1_000_000, cachedInput: 100_000, output: 5_000_000 },
  [ANTHROPIC_MODELS.super]: { input: 4_000_000, cachedInput: 200_000, output: 20_000_000 },
};

export const DEFAULT_BUDGET: ScanBudget = {
  maxFilesRead: 400,
  maxFileBytes: 48_000,
  maxInputTokens: 200_000,
  maxDocsChecks: 8,
  concurrency: 4,
  maxReadTokens: 4_000_000,
  readConcurrency: 3,
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
 * Which provider the environment selects: the forced one when its key is
 * set, else Nemotron when its key is set, else Claude, else none.
 */
export function detectProvider(): Provider | null {
  const forced = env("BIRDSI_PROVIDER");
  const nebius = env("NEBIUS_API_KEY") !== null;
  const anthropic = env("ANTHROPIC_API_KEY") !== null;
  if (forced === "nebius" && nebius) return "nebius";
  if (forced === "anthropic" && anthropic) return "anthropic";
  if (nebius) return "nebius";
  if (anthropic) return "anthropic";
  return null;
}

/** Builds the config from the environment. Never throws. */
export function loadEngineConfig(overrides: Partial<EngineConfig> = {}): EngineConfig {
  const provider = detectProvider();
  const defaults = provider === "anthropic" ? ANTHROPIC_MODELS : NEBIUS_MODELS;
  const models: Record<ModelTier, string> = {
    nano: env("BIRDSI_MODEL_NANO") ?? defaults.nano,
    super: env("BIRDSI_MODEL_SUPER") ?? defaults.super,
  };
  const prices: Record<string, ModelPrice> = { ...DEFAULT_PRICES };
  for (const tier of ["nano", "super"] as const) {
    // An id the table does not know is priced like the tier's default, so the ledger never prices it at zero.
    if (!prices[models[tier]]) prices[models[tier]] = DEFAULT_PRICES[defaults[tier]]!;
  }
  const baseUrl = env("NEBIUS_BASE_URL") ?? TOKEN_FACTORY_URL;
  return {
    provider,
    anthropic: { apiKey: env("ANTHROPIC_API_KEY") },
    tokenFactory: { apiKey: env("NEBIUS_API_KEY"), baseUrl: baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/` },
    models,
    tavilyApiKey: env("TAVILY_API_KEY"),
    reader: { enabled: env("BIRDSI_READER") !== "off" },
    github: {
      appId: env("GITHUB_APP_ID"),
      privateKey: env("GITHUB_APP_PRIVATE_KEY")?.replace(/\\n/g, "\n") ?? null,
      appSlug: env("GITHUB_APP_SLUG"),
    },
    budget: {
      ...DEFAULT_BUDGET,
      maxInputTokens: envInt("BIRDSI_DOCS_BUDGET_TOKENS", DEFAULT_BUDGET.maxInputTokens),
      concurrency: envInt("BIRDSI_DOCS_CONCURRENCY", DEFAULT_BUDGET.concurrency),
      maxReadTokens: envInt("BIRDSI_READ_BUDGET_TOKENS", DEFAULT_BUDGET.maxReadTokens),
      readConcurrency: envInt("BIRDSI_READ_CONCURRENCY", DEFAULT_BUDGET.readConcurrency),
    },
    prices,
    ...overrides,
  };
}
