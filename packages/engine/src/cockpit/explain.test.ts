import { describe, expect, it } from "vitest";
import type { VercelRead } from "@birdsi/shared";
import type { ModelClient } from "../models/client";
import { explainFailure, failedProduction } from "./explain";

const at = { readAt: "2026-10-27T20:00:00.000Z", source: { api: "x", page: null } };
const deployment = (id: string, state: "ERROR" | "READY", createdAt: string) => ({ id, url: null, state, target: "production" as const, createdAt, readyAt: null, commitSha: "abc1234", commitMessage: "Ship", branch: "main", errorMessage: state === "ERROR" ? "Build failed" : null, inspectorUrl: null });

function read(state: "ERROR" | "READY"): VercelRead {
  return {
    vendor: "vercel",
    project: { ok: true, ...at, value: { id: "prj_1", name: "cockpit", framework: "nextjs", productionUrl: "https://cockpit.example.com", paused: null, rootDirectory: "", createdAt: null } },
    deployments: { ok: true, ...at, value: [deployment("d2", state, "2026-10-27T19:00:00.000Z"), deployment("d1", "READY", "2026-10-26T19:00:00.000Z")] },
    env: { ok: true, ...at, value: [] },
    crons: { ok: true, ...at, value: { enabled: true, definitions: [], updatedAt: null, deploymentId: null } },
    domains: { ok: true, ...at, value: [] },
    errors: { ok: true, ...at, value: [{ at: "2026-10-27T19:01:00.000Z", deploymentId: "d2", from: "build", text: "Type error: Property 'name' does not exist on type 'User'." }] },
    keyExpiry: { ok: true, ...at, value: { expiresAt: null } },
  };
}

describe("a failed deployment explained", () => {
  it("finds the newest failed production deployment with its own error lines, and nothing when production is ready", () => {
    const failure = failedProduction(read("ERROR"))!;
    expect(failure.deployment.id).toBe("d2");
    expect(failure.lines.map((l) => l.text)).toEqual(["Type error: Property 'name' does not exist on type 'User'."]);
    expect(failedProduction(read("READY"))).toBeNull();
  });

  it("asks the small model for plain words and marks the answer as its", async () => {
    let seen = "";
    const models = {
      available: true,
      modelId: () => "fake-nano",
      complete: async (opts: { user: string }) => {
        seen = opts.user;
        return { whatBroke: "The build stopped on a type error in the code that reads a user's name.", whatToDo: "Open the file the error names and add the name field, then push again." };
      },
    } as unknown as ModelClient;
    const why = await explainFailure(models, { project: "cockpit", ...failedProduction(read("ERROR"))! });
    expect(why.model).toBe("fake-nano");
    expect(why.text).toContain("type error");
    expect(why.text).toContain("push again");
    expect(seen).toContain("Property 'name' does not exist");
    expect(seen).toContain("Vercel says: Build failed");
  });
});
