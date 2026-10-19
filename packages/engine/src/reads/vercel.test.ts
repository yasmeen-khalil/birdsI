import { afterEach, describe, expect, it, vi } from "vitest";
import { readVercelProject } from "./vercel";

const SECRET_VALUE = ["sk", "_live_", "51Hx", "QwErTyUiOpAsDfGh"].join("");

function stream(lines: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const l of lines) controller.enqueue(new TextEncoder().encode(`${l}\n`));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "application/stream+json" } });
}

function vercelApi(overrides: Record<string, () => Response> = {}) {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (input: string | URL) => {
    const url = String(input);
    calls.push(url);
    for (const [part, respond] of Object.entries(overrides)) if (url.includes(part)) return respond();
    if (url.includes("/v9/projects/flowsophy-ops/domains") || url.includes("/v9/projects/prj_ops/domains")) {
      return Response.json({ domains: [{ name: "ops.flowsophyapp.com", verified: true, redirect: null, gitBranch: null, verification: [{ value: "x" }] }] });
    }
    if (url.includes("/v9/projects/flowsophy-ops")) {
      return Response.json({
        id: "prj_ops",
        name: "flowsophy-ops",
        framework: "nextjs",
        rootDirectory: "app",
        createdAt: 1_760_000_000_000,
        targets: { production: { alias: ["flowsophy-ops.vercel.app", "ops.flowsophyapp.com"] } },
        crons: { enabledAt: 1_760_000_000_000, disabledAt: null, updatedAt: 1_760_100_000_000, deploymentId: "dpl_ready", definitions: [{ host: "ops.flowsophyapp.com", path: "/api/cron/purge-deleted", schedule: "0 4 * * *" }] },
        env: [{ key: "STRIPE_SECRET_KEY", value: SECRET_VALUE }],
      });
    }
    if (url.includes("/v2/teams/team_abc")) return Response.json({ slug: "flowsophy", name: "Flowsophy" });
    if (url.includes("/v5/user/tokens/current")) return Response.json({ token: { id: "tok", name: "birdsI", expiresAt: 1_768_000_000_000, scopes: [{ type: "team", teamId: "team_abc", expiresAt: 1_768_000_000_000 }] } });
    if (url.includes("/v7/deployments")) {
      return Response.json({
        deployments: [
          { uid: "dpl_err", url: "flowsophy-ops-err.vercel.app", state: "ERROR", target: "production", createdAt: 1_760_200_000_000, meta: { githubCommitSha: "abc1234", githubCommitMessage: "Closed Beta v4.423: the dashboard\nwatches itself", githubCommitRef: "master" }, errorMessage: "Command \"npm run build\" exited with 1", inspectorUrl: "https://vercel.com/flowsophy/flowsophy-ops/dpl_err" },
          { uid: "dpl_ready", url: "flowsophy-ops-ok.vercel.app", state: "READY", target: "production", createdAt: 1_760_100_000_000, ready: 1_760_100_060_000, meta: { githubCommitSha: "def5678", githubCommitMessage: "v4.422", githubCommitRef: "master" } },
          { uid: "dpl_preview", url: "flowsophy-ops-pr.vercel.app", state: "READY", target: null, createdAt: 1_760_050_000_000, meta: {} },
        ],
      });
    }
    if (url.includes("/v10/projects/prj_ops/env")) {
      return Response.json({
        envs: [
          { key: "STRIPE_SECRET_KEY", value: SECRET_VALUE, type: "encrypted", target: ["production"], id: "env1", updatedAt: 1_760_000_000_000, decrypted: false },
          { key: "APP_ROLE", value: "ops", type: "plain", target: ["production", "preview"], id: "env2", gitBranch: null },
          { key: "DEV_USER_IDS", type: "sensitive", target: ["production"], id: "env3" },
        ],
      });
    }
    if (url.includes("/v3/deployments/dpl_err/events")) {
      return Response.json([
        { type: "stdout", created: 1_760_200_010_000, payload: { text: "Installing dependencies" } },
        { type: "stderr", created: 1_760_200_020_000, payload: { text: `Error: STRIPE_SECRET_KEY=${SECRET_VALUE} is not valid` } },
        { type: "stdout", created: 1_760_200_030_000, payload: { text: "Build failed because of a type error" } },
      ]);
    }
    if (url.includes("/runtime-logs")) {
      return stream([
        JSON.stringify({ level: "info", message: "GET /", timestampInMs: 1_760_150_000_000 }),
        JSON.stringify({ level: "error", message: "Unhandled: cron_runs does not exist", timestampInMs: 1_760_150_001_000 }),
      ]);
    }
    return new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("reading a Vercel project", () => {
  it("reads every part, dated with its source, and never keeps an env value", async () => {
    vercelApi();
    const read = await readVercelProject("token", { project: "flowsophy-ops", team: "team_abc" }, { now: new Date() });
    expect(read.project).toMatchObject({ ok: true, value: { id: "prj_ops", name: "flowsophy-ops", productionUrl: "https://ops.flowsophyapp.com" }, source: { page: "https://vercel.com/flowsophy/flowsophy-ops" } });
    expect(read.deployments.ok && read.deployments.value.map((d) => [d.id, d.state, d.target])).toEqual([
      ["dpl_err", "ERROR", "production"],
      ["dpl_ready", "READY", "production"],
      ["dpl_preview", "READY", "preview"],
    ]);
    expect(read.deployments.ok && read.deployments.value[0]!.commitMessage).toBe("Closed Beta v4.423: the dashboard");
    expect(read.env.ok && read.env.value).toEqual([
      { key: "APP_ROLE", targets: ["production", "preview"], type: "plain", gitBranch: null, updatedAt: null },
      { key: "DEV_USER_IDS", targets: ["production"], type: "sensitive", gitBranch: null, updatedAt: null },
      { key: "STRIPE_SECRET_KEY", targets: ["production"], type: "encrypted", gitBranch: null, updatedAt: "2025-10-09T08:53:20.000Z" },
    ]);
    expect(read.crons).toMatchObject({ ok: true, value: { enabled: true, definitions: [{ path: "/api/cron/purge-deleted", schedule: "0 4 * * *" }] } });
    expect(read.domains).toMatchObject({ ok: true, value: [{ name: "ops.flowsophyapp.com", verified: true }] });
    expect(read.errors.ok && read.errors.value.map((e) => e.from)).toEqual(["build", "build", "runtime"]);
    expect(read.project.ok && read.project.value.rootDirectory).toBe("app");
    expect(read.keyExpiry).toMatchObject({ ok: true, value: { expiresAt: "2026-01-09T23:06:40.000Z" } });
    const text = JSON.stringify(read);
    expect(text).not.toContain(SECRET_VALUE);
    expect(text).not.toContain('"value":"ops"');
    expect(text).not.toContain("verification");
  });

  it("works with a key scoped to the project: the team cannot be read, and the links come from the inspector address", async () => {
    vercelApi({ "/v2/teams/team_abc": () => new Response("{}", { status: 403 }) });
    const read = await readVercelProject("token", { project: "flowsophy-ops", team: "team_abc" }, { now: new Date() });
    expect(read.project).toMatchObject({ ok: true, source: { page: "https://vercel.com/flowsophy/flowsophy-ops" } });
    expect(read.deployments.source.page).toBe("https://vercel.com/flowsophy/flowsophy-ops/deployments");
    expect(read.env.source.page).toBe("https://vercel.com/flowsophy/flowsophy-ops/settings/environment-variables");
  });

  it("says why a part could not be read, and reads the rest", async () => {
    vercelApi({ "/v10/projects/prj_ops/env": () => new Response("{}", { status: 403 }) });
    const read = await readVercelProject("token", { project: "flowsophy-ops", team: "team_abc" }, { now: new Date() });
    expect(read.env).toMatchObject({ ok: false, reason: expect.stringContaining("HTTP 403") });
    expect(read.deployments.ok).toBe(true);
    expect(read.domains.ok).toBe(true);
  });

  it("reads nothing else when the project cannot be read, and says so on every part", async () => {
    vercelApi({ "/v9/projects/flowsophy-ops": () => new Response("{}", { status: 404 }) });
    const read = await readVercelProject("token", { project: "flowsophy-ops", team: "team_abc" }, { now: new Date() });
    expect(read.project).toMatchObject({ ok: false, reason: expect.stringContaining("HTTP 404") });
    for (const part of [read.deployments, read.env, read.crons, read.domains, read.errors]) expect(part).toMatchObject({ ok: false, reason: expect.stringContaining("the project could not be read") });
  });
});
