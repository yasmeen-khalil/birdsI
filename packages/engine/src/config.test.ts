import { afterEach, describe, expect, it, vi } from "vitest";
import { ANTHROPIC_MODELS, detectProvider, loadEngineConfig, NEBIUS_MODELS } from "./config";

function stub(values: Record<string, string>): void {
  for (const name of ["NEBIUS_API_KEY", "ANTHROPIC_API_KEY", "BIRDSI_PROVIDER", "BIRDSI_MODEL_NANO", "BIRDSI_MODEL_SUPER", "NEBIUS_BASE_URL"]) {
    vi.stubEnv(name, values[name] ?? "");
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("detectProvider", () => {
  it("picks Nemotron when its key is set, Claude otherwise, none without a key", () => {
    stub({});
    expect(detectProvider()).toBeNull();
    stub({ ANTHROPIC_API_KEY: "a" });
    expect(detectProvider()).toBe("anthropic");
    stub({ ANTHROPIC_API_KEY: "a", NEBIUS_API_KEY: "n" });
    expect(detectProvider()).toBe("nebius");
    stub({ ANTHROPIC_API_KEY: "a", NEBIUS_API_KEY: "n", BIRDSI_PROVIDER: "anthropic" });
    expect(detectProvider()).toBe("anthropic");
  });

  it("ignores a forced provider whose key is missing", () => {
    stub({ ANTHROPIC_API_KEY: "a", BIRDSI_PROVIDER: "nebius" });
    expect(detectProvider()).toBe("anthropic");
  });
});

describe("loadEngineConfig", () => {
  it("takes the provider's models and prices an overridden id like the tier's default", () => {
    stub({ NEBIUS_API_KEY: "n", BIRDSI_MODEL_NANO: "nvidia/custom" });
    const config = loadEngineConfig();
    expect(config.provider).toBe("nebius");
    expect(config.models).toEqual({ nano: "nvidia/custom", super: NEBIUS_MODELS.super });
    expect(config.prices["nvidia/custom"]).toEqual(config.prices[NEBIUS_MODELS.nano]);
    expect(config.tokenFactory.baseUrl).toBe("https://api.tokenfactory.nebius.com/v1/");
  });

  it("takes Claude's models with only an Anthropic key and ends a custom address with a slash", () => {
    stub({ ANTHROPIC_API_KEY: "a", NEBIUS_BASE_URL: "https://example.test/v1" });
    const config = loadEngineConfig();
    expect(config.provider).toBe("anthropic");
    expect(config.models).toEqual(ANTHROPIC_MODELS);
    expect(config.tokenFactory.baseUrl).toBe("https://example.test/v1/");
    expect(config.tokenFactory.apiKey).toBeNull();
  });

  it("never throws without any key", () => {
    stub({});
    const config = loadEngineConfig();
    expect(config.provider).toBeNull();
    expect(config.models).toEqual(NEBIUS_MODELS);
  });
});
