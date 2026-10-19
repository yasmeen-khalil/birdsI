import type { ReadSource, VercelCrons, VercelDeployment, VercelDeploymentState, VercelDomain, VercelEnvName, VercelKeyExpiry, VercelLogLine, VercelProjectInfo, VercelRead } from "@birdsi/shared";
import { maskSecrets } from "../checks/secrets";
import { callJson, iso, notRead, ReadError, reading, str, type ReadContext } from "./http";

/**
 * A Vercel project in depth, with a token that reads: the project, its last
 * deployments with their state and age, its env names and where each applies
 * (never a value: every answer is copied field by field into birdsI's own
 * shape, and a value is never one of the fields), its crons, its domains,
 * and the error lines of its last failed build and of its functions.
 */

const API = "https://api.vercel.com";
const DEPLOYMENTS_READ = 20;
const LOG_LINES = 10;

interface Target {
  project: string;
  team: string | null;
}

function q(team: string | null, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({ ...(team ? { teamId: team } : {}), ...extra });
  const s = params.toString();
  return s ? `?${s}` : "";
}

const STATES: readonly VercelDeploymentState[] = ["BUILDING", "ERROR", "INITIALIZING", "QUEUED", "READY", "CANCELED", "BLOCKED", "DELETED"];

function state(value: unknown): VercelDeploymentState {
  const s = typeof value === "string" ? value.toUpperCase() : "";
  return (STATES as readonly string[]).includes(s) ? (s as VercelDeploymentState) : "UNKNOWN";
}

function firstLine(value: unknown, max = 120): string | null {
  const s = str(value);
  if (!s) return null;
  const line = s.split("\n")[0]!.trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function maskedLine(value: unknown, max = 300): string {
  const s = typeof value === "string" ? value : "";
  return maskSecrets(s.replace(/\s+/g, " ").trim()).slice(0, max);
}

/** The dashboard page of a project, when the team's slug is known; the team id cannot address a page. */
function pageFor(projectName: string | null, teamSlug: string | null, tail = ""): string | null {
  if (!projectName || !teamSlug) return null;
  return `https://vercel.com/${encodeURIComponent(teamSlug)}/${encodeURIComponent(projectName)}${tail}`;
}

export async function readVercelProject(token: string, target: Target, ctx: ReadContext): Promise<VercelRead> {
  const auth = { authorization: `Bearer ${token}` };
  const id = encodeURIComponent(target.project);
  const projectApi = `${API}/v9/projects/${id}${q(target.team)}`;

  // The project first: its id, name and crons. Every other part needs its id.
  let raw: Record<string, unknown> | null = null;
  let teamSlug: string | null = null;
  const project = await reading<VercelProjectInfo>({ api: projectApi.replace(/\?.*$/, ""), page: null }, ctx, async () => {
    const res = await callJson<Record<string, unknown>>("Vercel", projectApi, auth, ctx);
    raw = res.body ?? {};
    const name = str(raw["name"]);
    const pid = str(raw["id"]);
    if (!name || !pid) throw new ReadError("Vercel's answer for the project had no id or name.");
    // Vercel has no field for the production address: the production target's aliases, or else the project's production aliases.
    const targets = (raw["targets"] as Record<string, Record<string, unknown> | null> | null | undefined) ?? {};
    const production = targets["production"] ?? null;
    const fromTarget = Array.isArray(production?.["alias"]) ? (production!["alias"] as unknown[]).filter((a): a is string => typeof a === "string") : [];
    const fromAlias = Array.isArray(raw["alias"]) ? (raw["alias"] as Array<Record<string, unknown>>).filter((a) => a && a["environment"] === "production" && !a["redirect"]).map((a) => str(a["domain"])).filter((d): d is string => Boolean(d)) : [];
    const aliases = [...fromTarget, ...fromAlias];
    const productionUrl = aliases.find((a) => !a.endsWith(".vercel.app")) ?? aliases[0] ?? str(production?.["url"]) ?? null;
    const paused = typeof raw["paused"] === "boolean" ? (raw["paused"] as boolean) : null;
    const rootDirectory = !("rootDirectory" in raw) ? null : typeof raw["rootDirectory"] === "string" ? (raw["rootDirectory"] as string).replace(/^\.?\/+|\/+$/g, "") : "";
    return { id: pid, name, framework: str(raw["framework"]), productionUrl: productionUrl ? (productionUrl.startsWith("http") ? productionUrl : `https://${productionUrl}`) : null, paused, rootDirectory, createdAt: iso(raw["createdAt"]) };
  });
  if (target.team) {
    // The team's slug only makes dashboard links. A key scoped to the project cannot read the team; the
    // deployments' inspector links name the slug too, so it is taken from them below.
    const team = await callJson<{ slug?: string }>("Vercel", `${API}/v2/teams/${encodeURIComponent(target.team)}`, auth, ctx).catch(() => null);
    teamSlug = str(team?.body?.slug);
  }
  const name = project.ok ? project.value.name : null;
  const projectSource = (tail: string, api: string): ReadSource => ({ api, page: pageFor(name, teamSlug, tail) });
  if (project.ok) project.source.page = pageFor(name, teamSlug);

  if (!project.ok) {
    const reason = `Not read, because the project could not be read: ${project.reason}`;
    return {
      vendor: "vercel",
      project,
      deployments: notRead(projectSource("/deployments", `${API}/v7/deployments`), reason),
      env: notRead(projectSource("/settings/environment-variables", `${API}/v10/projects/${id}/env`), reason),
      crons: notRead(projectSource("/settings/cron-jobs", projectApi.replace(/\?.*$/, "")), reason),
      domains: notRead(projectSource("/settings/domains", `${API}/v9/projects/${id}/domains`), reason),
      errors: notRead(projectSource("/logs", `${API}/v3/deployments`), reason),
      keyExpiry: await readKeyExpiry(auth, ctx),
    };
  }
  const projectId = project.value.id;
  const pid = encodeURIComponent(projectId);
  const latest = Array.isArray((raw as Record<string, unknown> | null)?.["latestDeployments"]) ? ((raw as unknown as { latestDeployments: Array<Record<string, unknown>> }).latestDeployments) : [];
  if (!teamSlug) teamSlug = slugFromInspector(latest.map((d) => str(d["inspectorUrl"])).find(Boolean) ?? null);
  if (teamSlug) project.source.page = pageFor(name, teamSlug);

  const deploymentsApi = `${API}/v7/deployments`;
  const deployments = await reading<VercelDeployment[]>(projectSource("/deployments", deploymentsApi), ctx, async () => {
    const res = await callJson<{ deployments?: Array<Record<string, unknown>> }>("Vercel", `${deploymentsApi}${q(target.team, { projectId, limit: String(DEPLOYMENTS_READ) })}`, auth, ctx);
    const list = res.body?.deployments ?? [];
    if (!teamSlug) {
      teamSlug = slugFromInspector(list.map((d) => str(d["inspectorUrl"])).find(Boolean) ?? null);
      if (teamSlug) project.source.page = pageFor(name, teamSlug);
    }
    return list.map((d) => {
      const meta = (d["meta"] as Record<string, unknown> | undefined) ?? {};
      const url = str(d["url"]);
      return {
        id: String(d["uid"] ?? d["id"] ?? ""),
        url: url ? (url.startsWith("http") ? url : `https://${url}`) : null,
        state: state(d["state"] ?? d["readyState"]),
        target: str(d["target"]) ?? "preview",
        createdAt: iso(d["createdAt"] ?? d["created"]) ?? new Date(0).toISOString(),
        readyAt: iso(d["ready"]),
        commitSha: str(meta["githubCommitSha"]) ?? str(meta["gitlabCommitSha"]) ?? str(meta["bitbucketCommitSha"]),
        commitMessage: firstLine(meta["githubCommitMessage"] ?? meta["gitlabCommitMessage"] ?? meta["bitbucketCommitMessage"]),
        branch: str(meta["githubCommitRef"]) ?? str(meta["gitlabCommitRef"]) ?? str(meta["bitbucketCommitRef"]),
        errorMessage: firstLine(d["errorMessage"], 300),
        inspectorUrl: str(d["inspectorUrl"]),
      };
    });
  });

  if (!deployments.source.page) deployments.source.page = pageFor(name, teamSlug, "/deployments");

  const envApi = `${API}/v10/projects/${pid}/env`;
  const env = await reading<VercelEnvName[]>(projectSource("/settings/environment-variables", envApi), ctx, async () => {
    const res = await callJson<{ envs?: Array<Record<string, unknown>>; key?: string }>("Vercel", `${envApi}${q(target.team)}`, auth, ctx);
    // Vercel answers with a list, or with one variable when the project has one. Field by field: the value,
    // and anything else Vercel adds, is never copied.
    const list = Array.isArray(res.body?.envs) ? res.body!.envs! : res.body && typeof res.body.key === "string" ? [res.body as Record<string, unknown>] : [];
    return list
      .map((e) => ({
        key: String(e["key"] ?? ""),
        targets: Array.isArray(e["target"]) ? (e["target"] as unknown[]).filter((t): t is string => typeof t === "string") : typeof e["target"] === "string" ? [e["target"] as string] : [],
        type: str(e["type"]) ?? "unknown",
        gitBranch: str(e["gitBranch"]),
        updatedAt: iso(e["updatedAt"]),
      }))
      .filter((e) => e.key.length > 0)
      .sort((a, b) => a.key.localeCompare(b.key));
  });

  const crons = await reading<VercelCrons | null>(projectSource("/settings/cron-jobs", projectApi.replace(/\?.*$/, "")), ctx, async () => {
    const c = (raw as Record<string, unknown> | null)?.["crons"] as Record<string, unknown> | null | undefined;
    if (!c) return null;
    const definitions = Array.isArray(c["definitions"]) ? (c["definitions"] as Array<Record<string, unknown>>).map((d) => ({ path: String(d["path"] ?? ""), schedule: String(d["schedule"] ?? "") })).filter((d) => d.path) : [];
    return { enabled: c["disabledAt"] === null || c["disabledAt"] === undefined, definitions, updatedAt: iso(c["updatedAt"]), deploymentId: str(c["deploymentId"]) };
  });

  const domainsApi = `${API}/v9/projects/${pid}/domains`;
  const domains = await reading<VercelDomain[]>(projectSource("/settings/domains", domainsApi), ctx, async () => {
    const res = await callJson<{ domains?: Array<Record<string, unknown>> }>("Vercel", `${domainsApi}${q(target.team, { limit: "50" })}`, auth, ctx);
    return (res.body?.domains ?? []).map((d) => ({ name: String(d["name"] ?? ""), verified: typeof d["verified"] === "boolean" ? (d["verified"] as boolean) : null, redirect: str(d["redirect"]), gitBranch: str(d["gitBranch"]) })).filter((d) => d.name);
  });

  const errors = await reading<VercelLogLine[]>(projectSource("/logs", `${API}/v3/deployments`), ctx, async () => {
    if (!deployments.ok) throw new ReadError(`Not read, because the deployments could not be read: ${deployments.reason}`);
    const lines: VercelLogLine[] = [];
    const failed = deployments.value.find((d) => d.state === "ERROR");
    const latestReady = deployments.value.find((d) => d.state === "READY" && d.target === "production") ?? deployments.value.find((d) => d.state === "READY");
    if (failed) {
      // The last events of the failed build, newest first, without following the stream; kept oldest first.
      const res = await callJson<Array<Record<string, unknown>> | null>("Vercel", `${API}/v3/deployments/${encodeURIComponent(failed.id)}/events${q(target.team, { direction: "backward", limit: "200", follow: "0" })}`, auth, ctx);
      const found: VercelLogLine[] = [];
      for (const e of res.body ?? []) {
        const payload = (e["payload"] as Record<string, unknown> | undefined) ?? {};
        const text = str(payload["text"]) ?? str(e["text"]);
        const type = str(e["type"]) ?? "";
        const level = str(e["level"]) ?? "";
        if (!text || !(type === "stderr" || type === "fatal" || level === "error" || /\berror\b|failed/i.test(text))) continue;
        found.push({ at: iso(e["created"] ?? payload["date"] ?? e["date"]) ?? failed.createdAt, deploymentId: failed.id, from: "build", text: maskedLine(text) });
        if (found.length >= LOG_LINES) break;
      }
      lines.push(...found.reverse());
    }
    if (latestReady) {
      const runtime = await runtimeErrors(projectId, latestReady.id, target.team, auth, ctx);
      lines.push(...runtime);
    }
    return lines.slice(0, LOG_LINES * 2);
  });

  const keyExpiry = await readKeyExpiry(auth, ctx);
  return { vendor: "vercel", project, deployments, env, crons, domains, errors, keyExpiry };
}

/** The key's own expiry. A key scoped to one project cannot read user-level details, and says so. */
async function readKeyExpiry(auth: Record<string, string>, ctx: ReadContext) {
  const api = `${API}/v5/user/tokens/current`;
  return reading<VercelKeyExpiry>({ api, page: "https://vercel.com/account/settings/tokens" }, ctx, async () => {
    const res = await callJson<{ token?: { expiresAt?: unknown; scopes?: Array<{ expiresAt?: unknown }> } }>("Vercel", api, auth, ctx).catch((error: unknown) => {
      if (error instanceof ReadError && /HTTP 403/.test(error.message)) throw new ReadError("Not read: a key scoped to one project cannot read its own expiry. Vercel's token page shows it.");
      throw error;
    });
    const token = res.body?.token ?? {};
    const dates = [iso(token.expiresAt), ...(token.scopes ?? []).map((s) => iso(s.expiresAt))].filter((d): d is string => Boolean(d)).sort();
    return { expiresAt: dates[0] ?? null };
  });
}

/** The team's slug from an inspector link: https://vercel.com/<team>/<project>/<deployment>. */
function slugFromInspector(url: string | null): string | null {
  const m = url ? /^https:\/\/vercel\.com\/([^/]+)\/[^/]+\/[^/]+/.exec(url) : null;
  return m ? decodeURIComponent(m[1]!) : null;
}

/**
 * The error lines of a deployment's functions. Vercel streams runtime logs,
 * so the read takes what arrives within a few seconds and stops.
 */
async function runtimeErrors(projectId: string, deploymentId: string, team: string | null, auth: Record<string, string>, ctx: ReadContext): Promise<VercelLogLine[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6_000);
  const out: VercelLogLine[] = [];
  try {
    const res = await fetch(`${API}/v1/projects/${encodeURIComponent(projectId)}/deployments/${encodeURIComponent(deploymentId)}/runtime-logs${q(team)}`, { headers: { ...auth, accept: "application/stream+json" }, signal: controller.signal });
    if (!res.ok || !res.body) return out;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (out.length < LOG_LINES) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl = buffer.indexOf("\n");
      while (nl >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        nl = buffer.indexOf("\n");
        if (!line) continue;
        try {
          const row = JSON.parse(line) as Record<string, unknown>;
          const level = String(row["level"] ?? "").toLowerCase();
          if (level !== "error" && level !== "fatal") continue;
          out.push({ at: iso(row["timestampInMs"]) ?? new Date().toISOString(), deploymentId, from: "runtime", text: maskedLine(row["message"]) });
        } catch {
          // Not a log line.
        }
      }
    }
    await reader.cancel().catch(() => {});
  } catch {
    // Runtime logs are a bonus: a stream that stops or times out leaves the build errors as they are.
  } finally {
    clearTimeout(timer);
    void ctx;
  }
  return out;
}
