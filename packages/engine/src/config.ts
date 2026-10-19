/**
 * Engine configuration, read once from the environment by the process that
 * hosts the engine (worker or web).
 *
 * Since v3 nothing in birdsI needs a model except the official-docs check,
 * which compares a package's own current documentation with how the code
 * uses it. That check runs only when both ANTHROPIC_API_KEY and
 * TAVILY_API_KEY are set; without them a map still runs in full and says the
 * docs check was skipped.
 */
export interface EngineConfig {
  anthropic: {
    apiKey: string | null;
  };
  models: {
    /** The small model that reads documentation pages against the code. */
    docs: string;
  };
  tavilyApiKey: string | null;
  github: {
    appId: string | null;
    privateKey: string | null;
    appSlug: string | null;
  };
  /** Ceilings for one map of the code. */
  budget: ScanBudget;
  /** Approximate prices used for the usage ledger, per million tokens, in microdollars. */
  prices: Record<string, { input: number; output: number }>;
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
}

const DOCS_MODEL = "claude-haiku-4-5";

/** Microdollars per million tokens: $1 = 1,000,000 microdollars. */
const DEFAULT_PRICES: EngineConfig["prices"] = {
  [DOCS_MODEL]: { input: 1_000_000, output: 5_000_000 },
};

export const DEFAULT_BUDGET: ScanBudget = {
  maxFilesRead: 400,
  maxFileBytes: 48_000,
  maxInputTokens: 200_000,
  maxDocsChecks: 8,
  concurrency: 4,
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

/** Builds the config from the environment. Never throws: every integration degrades to "off" with a note. */
export function loadEngineConfig(overrides: Partial<EngineConfig> = {}): EngineConfig {
  const docsModel = env("BIRDSI_MODEL_DOCS") ?? DOCS_MODEL;
  const prices: EngineConfig["prices"] = { ...DEFAULT_PRICES };
  if (!prices[docsModel]) prices[docsModel] = DEFAULT_PRICES[DOCS_MODEL]!;
  return {
    anthropic: { apiKey: env("ANTHROPIC_API_KEY") },
    models: { docs: docsModel },
    tavilyApiKey: env("TAVILY_API_KEY"),
    github: {
      appId: env("GITHUB_APP_ID"),
      privateKey: env("GITHUB_APP_PRIVATE_KEY")?.replace(/\\n/g, "\n") ?? null,
      appSlug: env("GITHUB_APP_SLUG"),
    },
    budget: {
      ...DEFAULT_BUDGET,
      maxInputTokens: envInt("BIRDSI_DOCS_BUDGET_TOKENS", DEFAULT_BUDGET.maxInputTokens),
      concurrency: envInt("BIRDSI_DOCS_CONCURRENCY", DEFAULT_BUDGET.concurrency),
    },
    prices,
    ...overrides,
  };
}

export { DOCS_MODEL, DEFAULT_PRICES };
