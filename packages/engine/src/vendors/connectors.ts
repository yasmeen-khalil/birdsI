import { createPrivateKey, sign, type KeyObject } from "node:crypto";
import type { FactKind, FactSource } from "@birdsi/shared";

/**
 * Connectors read a vendor account with a token the owner provided and
 * return facts: the plan, usage and limits. Each is a small module behind
 * one interface; adding a vendor is adding an entry here.
 */
export interface ConnectorFact {
  kind: FactKind;
  metric: string;
  label: string;
  value: string;
  numeric: number | null;
  unit: string | null;
  limitNumeric: number | null;
  source: FactSource;
  evidence?: { url?: string; excerpt?: string; note?: string };
}

export interface ConnectorField {
  key: string;
  label: string;
  hint: string;
  required: boolean;
}

export interface Connector {
  slug: string;
  name: string;
  /** How to get the token, in one line. */
  tokenHint: string;
  /** Where to create it. */
  tokenUrl: string;
  fields: ConnectorField[];
  probe: (token: string, settings: Record<string, string>, signal?: AbortSignal) => Promise<ConnectorFact[]>;
}

const TIMEOUT_MS = 20_000;

async function getJson<T>(url: string, headers: Record<string, string>, signal?: AbortSignal): Promise<{ status: number; body: T | null; headers: Headers }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  signal?.addEventListener("abort", () => controller.abort(), { once: true });
  try {
    const response = await fetch(url, { headers: { accept: "application/json", ...headers }, signal: controller.signal });
    const text = await response.text();
    let body: T | null = null;
    try {
      body = text ? (JSON.parse(text) as T) : null;
    } catch {
      body = null;
    }
    return { status: response.status, body, headers: response.headers };
  } finally {
    clearTimeout(timer);
  }
}

function unauthorized(status: number, name: string): never {
  if (status === 401 || status === 403) throw new Error(`${name} did not accept the token. Check it has read access and has not expired.`);
  throw new Error(`${name} answered with HTTP ${status}.`);
}

const fact = (kind: FactKind, metric: string, label: string, value: string, numeric: number | null = null, unit: string | null = null, limitNumeric: number | null = null, evidence?: ConnectorFact["evidence"]): ConnectorFact => ({
  kind,
  metric,
  label,
  value,
  numeric,
  unit,
  limitNumeric,
  source: "connector",
  ...(evidence ? { evidence } : {}),
});

function monthRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { from: from.toISOString(), to: now.toISOString() };
}

async function vercelSpend(teamId: string, auth: Record<string, string>, signal?: AbortSignal): Promise<ConnectorFact> {
  const { from, to } = monthRange();
  const charges = await fetch(`https://api.vercel.com/v1/billing/charges?teamId=${encodeURIComponent(teamId)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { headers: auth, signal: signal ?? null });
  if (charges.ok) {
    const text = await charges.text();
    let total = 0;
    let lines = 0;
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line) as { BilledCost?: number | string; EffectiveCost?: number | string };
        const cost = Number(row.BilledCost ?? row.EffectiveCost ?? 0);
        if (Number.isFinite(cost)) total += cost;
        lines += 1;
      } catch {
        // Not a JSON line.
      }
    }
    if (lines > 0) return fact("cost", "spend_month", "Spend this month", `$${total.toFixed(2)}`, Math.round(total * 100) / 100, "USD", null, { note: "From Vercel's billing charges for the current month." });
    return fact("status", "billing_access", "Billing data", "Vercel returned no charges for this month.");
  }
  if (charges.status === 403 || charges.status === 404) return fact("status", "billing_access", "Billing data", "Spend is available through the API on Pro and Enterprise teams only.");
  return fact("status", "billing_access", "Billing data", `Vercel answered HTTP ${charges.status} for billing charges.`);
}

const vercel: Connector = {
  slug: "vercel",
  name: "Vercel",
  tokenHint: "An access token scoped to the team (it reads the plan and spend too) or to one project, with an expiry. Vercel offers no token that only reads, so birdsI only reads with it.",
  tokenUrl: "https://vercel.com/account/settings/tokens",
  fields: [{ key: "teamId", label: "Team id", hint: "Settings > General > Team ID. Leave empty for a personal account.", required: false }],
  async probe(token, settings, signal) {
    const auth = { authorization: `Bearer ${token}` };
    const facts: ConnectorFact[] = [];
    const teamId = settings["teamId"]?.trim();
    const project = settings["project"]?.trim();
    const teamQuery = teamId ? `?teamId=${encodeURIComponent(teamId)}` : "";
    if (project) {
      // One project: the key must read it. A key scoped to the project cannot read the team, so the plan
      // and spend then say why they were not read instead of failing the key.
      const found = await getJson<{ id?: string; name?: string }>(`https://api.vercel.com/v9/projects/${encodeURIComponent(project)}${teamQuery}`, auth, signal);
      if (found.status >= 400) unauthorized(found.status, "Vercel");
      if (!teamId) {
        facts.push(fact("status", "plan_access", "Plan", "Not read. Add the team id to the project to read the team's plan and spend.", null, null, null, { url: "https://vercel.com/docs/rest-api/teams/get-a-team" }));
        return facts;
      }
      const team = await getJson<{ billing?: { plan?: string } | null; resourceConfig?: Record<string, unknown> }>(`https://api.vercel.com/v2/teams/${encodeURIComponent(teamId)}`, auth, signal);
      if (team.status >= 400) {
        facts.push(fact("status", "plan_access", "Plan", team.status === 403 ? "Not read: the key is scoped to the project. A key scoped to the team reads the plan and this month's spend." : `Not read: Vercel answered HTTP ${team.status} for the team.`, null, null, null, { url: "https://vercel.com/docs/accounts/access-tokens" }));
        return facts;
      }
      const plan = team.body?.billing?.plan ?? null;
      if (plan) facts.push(fact("plan", "plan", "Plan", plan.charAt(0).toUpperCase() + plan.slice(1), null, null, null, { url: "https://vercel.com/docs/plans" }));
      facts.push(await vercelSpend(teamId, auth, signal));
      return facts;
    }
    if (teamId) {
      const team = await getJson<{ billing?: { plan?: string } | null; resourceConfig?: Record<string, unknown>; name?: string }>(`https://api.vercel.com/v2/teams/${encodeURIComponent(teamId)}`, auth, signal);
      if (team.status >= 400) unauthorized(team.status, "Vercel");
      const plan = team.body?.billing?.plan ?? null;
      if (plan) facts.push(fact("plan", "plan", "Plan", plan.charAt(0).toUpperCase() + plan.slice(1), null, null, null, { url: "https://vercel.com/docs/plans" }));
      const rc = team.body?.resourceConfig ?? {};
      for (const [key, label, unit] of [
        ["concurrentBuilds", "Concurrent builds", "builds"],
        ["blobStores", "Blob stores", "stores"],
        ["postgresDatabases", "Postgres databases", "databases"],
        ["kvDatabases", "KV databases", "databases"],
      ] as const) {
        const v = rc[key];
        if (typeof v === "number") facts.push(fact("limit", key, label, String(v), v, unit));
      }
      facts.push(await vercelSpend(teamId, auth, signal));
    } else {
      const me = await getJson<{ user?: { username?: string; email?: string } }>("https://api.vercel.com/v2/user", auth, signal);
      if (me.status >= 400) unauthorized(me.status, "Vercel");
      // The plan is read from a team. Without a team id it is not known, and birdsI does not guess it.
      facts.push(fact("status", "plan_access", "Plan", "Not read. Add the team id to read the team's plan and spend.", null, null, null, { url: "https://vercel.com/docs/rest-api/teams/get-a-team" }));
      if (me.body?.user?.username) facts.push(fact("status", "account", "Account", me.body.user.username));
    }
    const projects = await getJson<{ projects?: Array<{ name: string }> }>(`https://api.vercel.com/v9/projects?limit=100${teamId ? `&teamId=${encodeURIComponent(teamId)}` : ""}`, auth, signal);
    if (projects.status < 400 && projects.body?.projects) facts.push(fact("usage", "projects", "Projects", String(projects.body.projects.length), projects.body.projects.length, "projects"));
    return facts;
  },
};

/** One read-only query through the Management API (run as supabase_read_only_user); the first row, or null. */
async function supabaseQuery(token: string, ref: string, query: string, signal?: AbortSignal): Promise<Record<string, unknown> | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  signal?.addEventListener("abort", () => controller.abort(), { once: true });
  try {
    const response = await fetch(`https://api.supabase.com/v1/projects/${encodeURIComponent(ref)}/database/query/read-only`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ query }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const body = (await response.json()) as unknown;
    const rows = Array.isArray(body) ? body : body && typeof body === "object" && Array.isArray((body as { result?: unknown }).result) ? (body as { result: unknown[] }).result : [];
    const first = rows[0];
    return first && typeof first === "object" ? (first as Record<string, unknown>) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const SUPABASE_SIZE_QUERY = "select pg_catalog.pg_database_size(pg_catalog.current_database())::bigint as bytes";
const SUPABASE_SIZE_NOTE = "Read from the project's catalog with a read-only query through Supabase's Management API.";

function supabaseSizeFact(ref: string, row: Record<string, unknown> | null, suffix = "", label = ""): ConnectorFact | null {
  const bytes = row ? Number(row["bytes"]) : NaN;
  if (!Number.isFinite(bytes)) return null;
  const mb = Math.round((bytes / 1_048_576) * 10) / 10;
  return fact("usage", `db_size_mb${suffix}`, `Database size${label}`, `${mb.toLocaleString("en-US")} MB`, mb, "MB", null, { url: `https://supabase.com/dashboard/project/${encodeURIComponent(ref)}/database/settings`, note: SUPABASE_SIZE_NOTE });
}

function supabasePlanFact(plan: string | null): ConnectorFact | null {
  return plan ? fact("plan", "plan", "Plan", plan.charAt(0).toUpperCase() + plan.slice(1), null, null, null, { url: "https://supabase.com/pricing" }) : null;
}

const supabase: Connector = {
  slug: "supabase",
  name: "Supabase",
  tokenHint: "A personal access token from your Supabase account, read only. It reads the plan, the project's status, size, advisors and migrations, and never a row of the app's tables.",
  tokenUrl: "https://supabase.com/dashboard/account/tokens",
  fields: [
    { key: "projectRef", label: "Project ref", hint: "The project's reference id, from its URL: supabase.com/dashboard/project/<ref>. Leave empty and birdsI reads up to three active projects.", required: false },
    { key: "orgSlug", label: "Organization slug", hint: "From the organization's URL: supabase.com/dashboard/org/<slug>. Leave empty to use the first organization.", required: false },
  ],
  async probe(token, settings, signal) {
    const auth = { authorization: `Bearer ${token}` };
    const facts: ConnectorFact[] = [];
    const ref = settings["projectRef"]?.trim();
    if (ref) {
      // One project, the way a key scoped to that project reads it: the project, then its organization's plan when the key may read it.
      const project = await getJson<{ ref?: string; name?: string; status?: string; organization_slug?: string; organization_id?: string }>(`https://api.supabase.com/v1/projects/${encodeURIComponent(ref)}`, auth, signal);
      if (project.status >= 400) unauthorized(project.status, "Supabase");
      const status = String(project.body?.status ?? "UNKNOWN").toUpperCase();
      const slug = project.body?.organization_slug ?? project.body?.organization_id ?? null;
      if (slug) {
        const org = await getJson<{ plan?: string; name?: string }>(`https://api.supabase.com/v1/organizations/${encodeURIComponent(slug)}`, auth, signal);
        const plan = supabasePlanFact(org.status < 400 ? (org.body?.plan ?? null) : null);
        if (plan) facts.push(plan);
        else facts.push(fact("status", "plan_access", "Plan", org.status === 403 ? "Not read: the key cannot read the organization's settings. Give it Organization Settings: Read to read the plan." : "Not read: Supabase did not say the organization's plan.", null, null, null, { url: "https://supabase.com/dashboard/account/tokens" }));
        if (org.status < 400 && org.body?.name) facts.push(fact("status", "organization", "Organization", org.body.name));
      }
      facts.push(fact("status", "project_status", "Project status", status === "INACTIVE" ? "Paused" : status === "ACTIVE_HEALTHY" ? "Running" : status.toLowerCase().replace(/_/g, " "), null, null, null, { url: `https://supabase.com/dashboard/project/${encodeURIComponent(ref)}` }));
      if (status === "INACTIVE") {
        facts.push(fact("status", "paused_projects", "Paused projects", project.body?.name ?? ref, 1, "projects", null, { note: "Free projects pause after a week without traffic." }));
        return facts;
      }
      // The database size, read from the catalog. Rows of the app's own tables (its users, its files) are never
      // read: the owner's rule is that an app's data is read only through the app's ops API or exports.
      const size = supabaseSizeFact(ref, await supabaseQuery(token, ref, SUPABASE_SIZE_QUERY, signal));
      facts.push(size ?? fact("status", "usage_access", "Database size", "Not read: the key could not run the read-only size query. Give it Database: Read.", null, null, null, { url: `https://supabase.com/dashboard/project/${encodeURIComponent(ref)}/database/settings` }));
      return facts;
    }

    // An organization, or a key from before keys belonged to projects: the organization's plan and its projects.
    const orgs = await getJson<Array<{ id: string; slug?: string; name: string; plan?: string }>>("https://api.supabase.com/v1/organizations", auth, signal);
    if (orgs.status >= 400) unauthorized(orgs.status, "Supabase");
    const list = orgs.body ?? [];
    const wanted = settings["orgSlug"]?.trim();
    const org = (wanted ? list.find((o) => o.slug === wanted || o.id === wanted) : list[0]) ?? null;
    if (!org) throw new Error(wanted ? `No Supabase organization named ${wanted} is visible to this token.` : "This token sees no Supabase organizations.");
    let plan = org.plan ?? null;
    if (!plan && (org.slug ?? org.id)) {
      const detail = await getJson<{ plan?: string }>(`https://api.supabase.com/v1/organizations/${encodeURIComponent(org.slug ?? org.id)}`, auth, signal);
      plan = detail.body?.plan ?? null;
    }
    const planFact = supabasePlanFact(plan);
    if (planFact) facts.push(planFact);
    facts.push(fact("status", "organization", "Organization", org.name));

    const projects = await getJson<Array<{ id: string; ref?: string; name: string; status?: string; organization_id?: string; organization_slug?: string }>>("https://api.supabase.com/v1/projects", auth, signal);
    const mine = (projects.status < 400 && projects.body ? projects.body : []).filter((p) => (!p.organization_id && !p.organization_slug) || p.organization_id === org.id || p.organization_slug === org.slug);
    facts.push(fact("usage", "projects", "Projects", String(mine.length), mine.length, "projects"));
    const paused = mine.filter((p) => String(p.status ?? "").toUpperCase() === "INACTIVE");
    if (paused.length > 0) facts.push(fact("status", "paused_projects", "Paused projects", paused.map((p) => p.name).join(", "), paused.length, "projects", null, { note: "Free projects pause after a week without traffic." }));
    const targets = mine.filter((p) => String(p.status ?? "ACTIVE_HEALTHY").toUpperCase().startsWith("ACTIVE")).slice(0, 3);
    const many = targets.length > 1;
    let readAny = false;
    for (const p of targets) {
      const r = p.ref ?? p.id;
      const size = supabaseSizeFact(r, await supabaseQuery(token, r, SUPABASE_SIZE_QUERY, signal), many ? `:${r}` : "", many ? ` (${p.name})` : "");
      if (size) {
        facts.push(size);
        readAny = true;
      }
    }
    if (!readAny) facts.push(fact("status", "usage_access", "Database size", targets.length === 0 ? "No active project to read. Add the project on the Projects page." : "Not read: the key could not run the read-only size query. Give it Database: Read.", null, null, null, { url: "https://supabase.com/dashboard/projects" }));
    return facts;
  },
};

const tavilyConnector: Connector = {
  slug: "tavily",
  name: "Tavily",
  tokenHint: "The same API key the app uses.",
  tokenUrl: "https://app.tavily.com/home",
  fields: [],
  async probe(token, _settings, signal) {
    const res = await getJson<{ key?: { usage?: number; limit?: number }; account?: { plan_usage?: number; plan_limit?: number; current_plan?: string; paygo_usage?: number; paygo_limit?: number } }>("https://api.tavily.com/usage", { authorization: `Bearer ${token}` }, signal);
    if (res.status >= 400) unauthorized(res.status, "Tavily");
    const facts: ConnectorFact[] = [];
    const account = res.body?.account;
    const key = res.body?.key;
    if (account?.current_plan) facts.push(fact("plan", "plan", "Plan", account.current_plan));
    const used = account?.plan_usage ?? key?.usage ?? null;
    const limit = account?.plan_limit ?? key?.limit ?? null;
    if (used !== null) facts.push(fact("usage", "credits_month", "Credits used this month", limit !== null ? `${used} of ${limit}` : String(used), used, "credits", limit));
    if (limit !== null) facts.push(fact("limit", "credits_limit", "Monthly credits", String(limit), limit, "credits"));
    if (account?.paygo_usage !== undefined && account.paygo_usage > 0) facts.push(fact("cost", "paygo_credits", "Pay-as-you-go credits used", String(account.paygo_usage), account.paygo_usage, "credits"));
    return facts;
  },
};

const supadata: Connector = {
  slug: "supadata",
  name: "Supadata",
  tokenHint: "The same API key the app uses.",
  tokenUrl: "https://dash.supadata.ai",
  fields: [],
  async probe(token, _settings, signal) {
    const res = await getJson<Record<string, unknown>>("https://api.supadata.ai/v1/me", { "x-api-key": token }, signal);
    if (res.status >= 400) unauthorized(res.status, "Supadata");
    const body = res.body ?? {};
    const facts: ConnectorFact[] = [];
    const plan = (body["plan"] ?? body["subscription"] ?? body["tier"]) as string | Record<string, unknown> | undefined;
    const planName = typeof plan === "string" ? plan : plan && typeof plan === "object" ? String((plan as Record<string, unknown>)["name"] ?? (plan as Record<string, unknown>)["status"] ?? "") : "";
    if (planName) facts.push(fact("plan", "plan", "Plan", planName.charAt(0).toUpperCase() + planName.slice(1)));
    const remaining = numberIn(body, ["creditsRemaining", "credits_remaining", "remainingCredits", "remaining_credits", "credits"]);
    const limit = numberIn(body, ["creditsLimit", "credits_limit", "monthlyCredits", "monthly_credits", "limit"]);
    const used = numberIn(body, ["creditsUsed", "credits_used", "usedCredits", "used_credits"]);
    if (remaining !== null) facts.push(fact("usage", "credits_remaining", "Credits remaining", limit !== null ? `${remaining} of ${limit}` : String(remaining), remaining, "credits", limit));
    if (used !== null) facts.push(fact("usage", "credits_used", "Credits used", limit !== null ? `${used} of ${limit}` : String(used), used, "credits", limit));
    if (limit !== null) facts.push(fact("limit", "credits_limit", "Monthly credits", String(limit), limit, "credits"));
    if (facts.length === 0) facts.push(fact("status", "account", "Account", "Connected. Supadata answered but reported no plan or credit fields birdsI recognises.", null, null, null, { excerpt: JSON.stringify(body).slice(0, 300) }));
    return facts;
  },
};

const stripe: Connector = {
  slug: "stripe",
  name: "Stripe",
  tokenHint: "A restricted key with read access to Balance, Charges and Webhook Endpoints.",
  tokenUrl: "https://dashboard.stripe.com/apikeys",
  fields: [],
  async probe(token, _settings, signal) {
    const auth = { authorization: `Bearer ${token}` };
    const balance = await getJson<{ available?: Array<{ amount: number; currency: string }>; pending?: Array<{ amount: number; currency: string }>; livemode?: boolean }>("https://api.stripe.com/v1/balance", auth, signal);
    if (balance.status >= 400) unauthorized(balance.status, "Stripe");
    const facts: ConnectorFact[] = [];
    const sum = (rows: Array<{ amount: number; currency: string }> | undefined) => (rows ?? []).reduce((n, r) => n + r.amount, 0) / 100;
    const currency = balance.body?.available?.[0]?.currency?.toUpperCase() ?? "USD";
    facts.push(fact("billing", "balance_available", "Available balance", `${sum(balance.body?.available).toFixed(2)} ${currency}`, sum(balance.body?.available), currency));
    facts.push(fact("billing", "balance_pending", "Pending balance", `${sum(balance.body?.pending).toFixed(2)} ${currency}`, sum(balance.body?.pending), currency));
    facts.push(fact("status", "mode", "Mode", balance.body?.livemode ? "Live" : "Test"));
    const since = Math.floor(new Date(monthRange().from).getTime() / 1000);
    // Every charge this month, page by page, up to 1,000. Refunds come off; Stripe's fees are not read.
    let gross = 0;
    let refunded = 0;
    let count = 0;
    let after: string | null = null;
    let complete = false;
    for (let page = 0; page < 10; page++) {
      const url: string = `https://api.stripe.com/v1/charges?limit=100&created[gte]=${since}${after ? `&starting_after=${encodeURIComponent(after)}` : ""}`;
      const charges: { status: number; body: { data?: Array<{ id: string; amount: number; amount_refunded?: number; paid: boolean }>; has_more?: boolean } | null; headers: Headers } = await getJson(url, auth, signal);
      if (charges.status >= 400 || !charges.body?.data) break;
      for (const c of charges.body.data) {
        if (!c.paid) continue;
        gross += c.amount;
        refunded += c.amount_refunded ?? 0;
        count += 1;
      }
      const last = charges.body.data[charges.body.data.length - 1];
      if (!charges.body.has_more || !last) {
        complete = true;
        break;
      }
      after = last.id;
    }
    if (count > 0 || complete) {
      const net = (gross - refunded) / 100;
      facts.push(fact("billing", "revenue_month", "Revenue this month, after refunds", `${net.toFixed(2)} ${currency}${complete ? "" : " (the first 1,000 charges)"}`, net, currency, null, { note: "Paid charges created this month, minus what was refunded. Stripe's fees are not taken off." }));
      facts.push(fact("usage", "charges_month", "Paid charges this month", String(count), count, "charges"));
    }
    // The webhook endpoints registered at Stripe, so the cockpit can check them against the webhook routes in the code.
    const hooks = await getJson<{ data?: Array<{ id: string; url?: string; status?: string; enabled_events?: string[]; livemode?: boolean }> } | { error?: { message?: string } }>("https://api.stripe.com/v1/webhook_endpoints?limit=100", auth, signal);
    const list = hooks.status < 400 && hooks.body && "data" in hooks.body && Array.isArray(hooks.body.data) ? hooks.body.data : null;
    if (list) {
      const dashboard = balance.body?.livemode === false ? "https://dashboard.stripe.com/test/webhooks" : "https://dashboard.stripe.com/webhooks";
      facts.push(fact("usage", "webhook_endpoints", "Webhook endpoints", list.length === 0 ? "None registered" : `${list.length} registered: ${list.map((h) => `${h.url ?? "?"} (${h.status ?? "unknown"})`).join(", ")}`, list.length, "endpoints", null, { url: dashboard, note: "What Stripe sends events to, checked against the webhook routes in the code." }));
      for (const h of list) {
        const events = h.enabled_events ?? [];
        const enabled = h.status === "enabled";
        facts.push(fact("status", `webhook_endpoint:${h.id}`, `Webhook endpoint, ${enabled ? "enabled" : "disabled"}${h.livemode === false ? ", test mode" : ""}`, h.url ?? "", enabled ? 1 : 0, null, null, { url: dashboard, note: events.includes("*") ? "Every event." : `${events.length} ${events.length === 1 ? "event" : "events"}: ${events.slice(0, 8).join(", ")}${events.length > 8 ? ` and ${events.length - 8} more` : ""}` }));
      }
    } else {
      const said = hooks.body && "error" in hooks.body ? hooks.body.error?.message : undefined;
      facts.push(fact("status", "webhooks_access", "Webhook endpoints", hooks.status === 401 || hooks.status === 403 ? "Not read: give the restricted key Webhook Endpoints: Read, so the cockpit can check them against the webhook routes in the code." : `Not read: Stripe answered HTTP ${hooks.status}${said ? ` (${said})` : ""}.`, null, null, null, { url: "https://dashboard.stripe.com/apikeys" }));
    }
    return facts;
  },
};

interface AnthropicBucket {
  results?: Array<Record<string, unknown>>;
}
interface AnthropicPage {
  data?: AnthropicBucket[];
  has_more?: boolean;
  next_page?: string | null;
}

async function anthropicReport(path: string, headers: Record<string, string>, signal?: AbortSignal): Promise<AnthropicBucket[]> {
  const out: AnthropicBucket[] = [];
  let page: string | null = null;
  for (let i = 0; i < 12; i++) {
    const url: string = `https://api.anthropic.com${path}${page ? `&page=${encodeURIComponent(page)}` : ""}`;
    const res: { status: number; body: AnthropicPage | null; headers: Headers } = await getJson<AnthropicPage>(url, headers, signal);
    if (res.status >= 400) {
      if (i === 0) unauthorized(res.status, "Anthropic");
      break;
    }
    out.push(...(res.body?.data ?? []));
    if (!res.body?.has_more || !res.body.next_page) break;
    page = res.body.next_page;
  }
  return out;
}

const anthropic: Connector = {
  slug: "anthropic",
  name: "Anthropic (Claude)",
  tokenHint: "An Admin API key (starts with sk-ant-admin). Regular keys cannot read usage.",
  tokenUrl: "https://platform.claude.com/settings/admin-keys",
  fields: [],
  async probe(token, _settings, signal) {
    const { from } = monthRange();
    const headers = { "x-api-key": token, "anthropic-version": "2023-06-01" };
    const cost = await anthropicReport(`/v1/organizations/cost_report?starting_at=${encodeURIComponent(from)}&limit=31`, headers, signal);
    let totalCents = 0;
    for (const bucket of cost) for (const r of bucket.results ?? []) totalCents += Number(r["amount"] ?? 0);
    const facts: ConnectorFact[] = [fact("cost", "spend_month", "Spend this month", `$${(totalCents / 100).toFixed(2)}`, Math.round(totalCents) / 100, "USD", null, { note: "From the Anthropic cost report, every day of the month." })];
    const usage = await anthropicReport(`/v1/organizations/usage_report/messages?starting_at=${encodeURIComponent(from)}&bucket_width=1d&limit=31`, headers, signal);
    let input = 0;
    let cached = 0;
    let output = 0;
    for (const bucket of usage) for (const r of bucket.results ?? []) {
      input += Number(r["uncached_input_tokens"] ?? 0);
      cached += Number(r["cache_read_input_tokens"] ?? 0) + Number(r["cache_creation_input_tokens"] ?? 0);
      output += Number(r["output_tokens"] ?? 0);
    }
    facts.push(fact("usage", "input_tokens_month", "Input tokens this month", input.toLocaleString("en-US"), input, "tokens"));
    if (cached > 0) facts.push(fact("usage", "cached_tokens_month", "Cached input tokens this month", cached.toLocaleString("en-US"), cached, "tokens", null, { note: "Read from or written to the prompt cache, and billed at the cache rates." }));
    facts.push(fact("usage", "output_tokens_month", "Output tokens this month", output.toLocaleString("en-US"), output, "tokens"));
    return facts;
  },
};

const resend: Connector = {
  slug: "resend",
  name: "Resend",
  tokenHint: "An API key with full access, so the quota headers are returned.",
  tokenUrl: "https://resend.com/api-keys",
  fields: [],
  async probe(token, _settings, signal) {
    const res = await getJson<{ data?: unknown[] }>("https://api.resend.com/domains", { authorization: `Bearer ${token}` }, signal);
    if (res.status >= 400) unauthorized(res.status, "Resend");
    const facts: ConnectorFact[] = [];
    const monthly = res.headers.get("x-resend-monthly-quota");
    const daily = res.headers.get("x-resend-daily-quota");
    if (monthly) {
      const [used, limit] = monthly.split("/").map((s) => Number(s.trim()));
      if (Number.isFinite(used)) facts.push(fact("usage", "emails_month", "Emails sent this month", limit ? `${used} of ${limit}` : String(used), used!, "emails", Number.isFinite(limit) ? limit! : null, { note: "From Resend's quota headers." }));
    }
    if (daily) {
      const [used, limit] = daily.split("/").map((s) => Number(s.trim()));
      if (Number.isFinite(used)) facts.push(fact("usage", "emails_day", "Emails sent today", limit ? `${used} of ${limit}` : String(used), used!, "emails", Number.isFinite(limit) ? limit! : null));
      facts.push(fact("plan", "plan", "Plan", "Free", null, null, null, { note: "A daily quota is reported only on the free plan." }));
    }
    const domains = Array.isArray(res.body?.data) ? res.body!.data!.length : null;
    if (domains !== null) facts.push(fact("usage", "domains", "Sending domains", String(domains), domains, "domains"));
    if (facts.length === 0) facts.push(fact("status", "account", "Account", "Connected. Resend shows its quota only after the app sends email, so none is known yet."));
    return facts;
  },
};

function numberIn(body: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = body[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

const onesignal: Connector = {
  slug: "onesignal",
  name: "OneSignal",
  tokenHint: "An App API key for this app (Settings > Keys & IDs). OneSignal keys cannot be made read only, so birdsI only reads with it, and an IP allowlist is not needed.",
  tokenUrl: "https://dashboard.onesignal.com",
  fields: [{ key: "appId", label: "App id", hint: "OneSignal > the app > Settings > Keys & IDs > OneSignal App ID.", required: true }],
  async probe(token, settings, signal) {
    const appId = settings["appId"]?.trim();
    if (!appId) throw new Error("A OneSignal key reads one app: add the app id.");
    // The answer carries push credentials; only the counts and the name are read from it.
    const app = await getJson<{ name?: string; players?: number; messageable_players?: number }>(`https://api.onesignal.com/apps/${encodeURIComponent(appId)}`, { authorization: `Key ${token}`, "content-type": "application/json" }, signal);
    if (app.status >= 400) unauthorized(app.status, "OneSignal");
    const facts: ConnectorFact[] = [];
    const page = `https://dashboard.onesignal.com/apps/${encodeURIComponent(appId)}`;
    const subscribed = typeof app.body?.messageable_players === "number" ? app.body.messageable_players : null;
    const total = typeof app.body?.players === "number" ? app.body.players : null;
    if (subscribed !== null) facts.push(fact("usage", "subscribed", "Subscribed", subscribed.toLocaleString("en-US"), subscribed, "subscriptions", null, { url: page, note: "Subscriptions that can receive a message now, as OneSignal counts them. Not the same as monthly active users, which the free plan's limit counts and the API does not report." }));
    if (total !== null) facts.push(fact("usage", "subscriptions", "Subscriptions", total.toLocaleString("en-US"), total, "subscriptions", null, { url: page }));
    return facts;
  },
};

/** A date in words for a reader, from an ISO timestamp, or nothing. */
function dayWords(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/* --------------------------------------------------------------- Clerk */

const CLERK_API = "https://api.clerk.com/v1";

const clerk: Connector = {
  slug: "clerk",
  name: "Clerk",
  tokenHint: "The instance's secret key (sk_live_ or sk_test_). Clerk has no read-only key, so birdsI only reads with it: counts and settings, never a user's data.",
  tokenUrl: "https://dashboard.clerk.com",
  fields: [{ key: "instanceId", label: "Instance id", hint: "ins_..., from Configure in the Clerk dashboard. The key is checked against it.", required: false }],
  async probe(token, settings, signal) {
    if (/^pk_(live|test)_/.test(token)) throw new Error("That is the publishable key. birdsI needs the instance's secret key (sk_live_ or sk_test_).");
    const auth = { authorization: `Bearer ${token}` };
    const instance = await getJson<{ id?: string; environment_type?: string; max_allowed_users?: number | null }>(`${CLERK_API}/instance`, auth, signal);
    if (instance.status >= 400) unauthorized(instance.status, "Clerk");
    const wanted = settings["instanceId"]?.trim();
    const id = instance.body?.id ?? null;
    if (wanted && id && id !== wanted) throw new Error(`This key belongs to the Clerk instance ${id}, not ${wanted}. Paste the secret key of this instance.`);
    const facts: ConnectorFact[] = [];
    const env = instance.body?.environment_type ?? null;
    if (env) facts.push(fact("status", "environment", "Instance", env === "production" ? "Production" : env === "development" ? "Development" : env, null, null, null, { url: "https://dashboard.clerk.com" }));
    const cap = typeof instance.body?.max_allowed_users === "number" && instance.body.max_allowed_users > 0 ? instance.body.max_allowed_users : null;
    const users = await getJson<{ total_count?: number }>(`${CLERK_API}/users/count`, auth, signal);
    if (users.status < 400 && typeof users.body?.total_count === "number") {
      const n = users.body.total_count;
      facts.push(fact("usage", "users_total", "Users", cap ? `${n.toLocaleString("en-US")} of ${cap.toLocaleString("en-US")}` : n.toLocaleString("en-US"), n, "users", cap, { url: "https://dashboard.clerk.com", note: "Every user of the instance, as Clerk counts them. Not monthly retained users, which the plan's limit counts and the API does not report." }));
    }
    const orgs = await getJson<{ total_count?: number }>(`${CLERK_API}/organizations?limit=1`, auth, signal);
    if (orgs.status < 400 && typeof orgs.body?.total_count === "number") facts.push(fact("usage", "organizations_total", "Organizations", orgs.body.total_count.toLocaleString("en-US"), orgs.body.total_count, "organizations", null, { url: "https://dashboard.clerk.com" }));
    facts.push(fact("status", "not_reported", "Not in Clerk's API", "The plan, and the monthly retained users it is billed on. The dashboard's Overview shows both. The checked limits list uses the plan you set on the project.", null, null, null, { url: "https://dashboard.clerk.com" }));
    return facts;
  },
};

/* ---------------------------------------------------------- RevenueCat */

const RC_API = "https://api.revenuecat.com/v2";
const RC_APP_TYPE: Record<string, string> = { app_store: "App Store", play_store: "Play Store", stripe: "Stripe", amazon: "Amazon", mac_app_store: "Mac App Store", roku: "Roku", paddle: "Paddle", rc_billing: "Web Billing", test_store: "Test Store", external: "External", galaxy: "Galaxy Store" };
/** Overview metrics with a name of their own here. The rest come through under RevenueCat's own name and unit. */
const RC_METRICS: Record<string, { metric: string; label: string; kind: FactKind; unit: string | null }> = {
  active_subscriptions: { metric: "active_subscriptions", label: "Active subscriptions", kind: "usage", unit: "subscriptions" },
  active_trials: { metric: "active_trials", label: "Active trials", kind: "usage", unit: "trials" },
  mrr: { metric: "mrr", label: "Monthly recurring revenue", kind: "billing", unit: "USD" },
  revenue: { metric: "mtr_usd_month", label: "Revenue, last 28 days (close to the monthly tracked revenue RevenueCat bills on)", kind: "usage", unit: "USD" },
  new_customers: { metric: "new_customers", label: "New customers, last 28 days", kind: "usage", unit: "customers" },
  active_users: { metric: "active_users", label: "Active users, last 28 days", kind: "usage", unit: "users" },
};

const revenuecat: Connector = {
  slug: "revenuecat",
  name: "RevenueCat",
  tokenHint: "A v2 secret API key made in this project, with read permission on projects, apps and overview metrics.",
  tokenUrl: "https://app.revenuecat.com",
  fields: [{ key: "projectId", label: "Project id", hint: "proj..., from the project's address on app.revenuecat.com.", required: true }],
  async probe(token, settings, signal) {
    const projectId = settings["projectId"]?.trim();
    if (!projectId) throw new Error("A RevenueCat key reads one project: add the project id.");
    const auth = { authorization: `Bearer ${token}` };
    const projects = await getJson<{ items?: Array<{ id: string; name?: string }> }>(`${RC_API}/projects?limit=100`, auth, signal);
    if (projects.status === 403) throw new Error("RevenueCat refused the key for projects. Give the v2 key project_configuration:projects:read, and check it was made in this project.");
    if (projects.status >= 400) unauthorized(projects.status, "RevenueCat");
    const project = (projects.body?.items ?? []).find((p) => p.id === projectId);
    if (!project) throw new Error(`This key sees no RevenueCat project with id ${projectId}. Check the id in the project's address, and that the key was made in that project.`);
    const page = `https://app.revenuecat.com/projects/${encodeURIComponent(projectId)}`;
    const facts: ConnectorFact[] = [fact("status", "project", "Project", project.name ?? projectId, null, null, null, { url: page })];
    const apps = await getJson<{ items?: Array<{ id: string; name?: string; type?: string }> }>(`${RC_API}/projects/${encodeURIComponent(projectId)}/apps?limit=100`, auth, signal);
    if (apps.status < 400) {
      const items = apps.body?.items ?? [];
      facts.push(fact("usage", "apps", "Apps", items.length === 0 ? "None" : items.map((a) => `${a.name ?? a.id} (${RC_APP_TYPE[a.type ?? ""] ?? a.type ?? "unknown"})`).join(", "), items.length, "apps", null, { url: `${page}/apps` }));
    } else {
      facts.push(fact("status", "apps_access", "Apps", apps.status === 403 ? "Not read: give the key project_configuration:apps:read." : `Not read: RevenueCat answered HTTP ${apps.status}.`, null, null, null, { url: page }));
    }
    const metrics = await getJson<{ currency?: string; metrics?: Array<{ id: string; name?: string; description?: string; unit?: string; period?: string; value?: number }> }>(`${RC_API}/projects/${encodeURIComponent(projectId)}/metrics/overview?currency=USD`, auth, signal);
    if (metrics.status >= 400) {
      facts.push(fact("status", "metrics_access", "Overview metrics", metrics.status === 403 ? "Not read: give the key charts_metrics:overview:read." : `Not read: RevenueCat answered HTTP ${metrics.status}.`, null, null, null, { url: `${page}/overview` }));
      return facts;
    }
    const currency = metrics.body?.currency ?? "USD";
    for (const m of metrics.body?.metrics ?? []) {
      if (typeof m.value !== "number" || !Number.isFinite(m.value)) continue;
      const known = RC_METRICS[m.id];
      const money = m.unit === "$" || known?.unit === "USD";
      const value = Math.round(m.value * 100) / 100;
      const label = known?.label ?? `${m.name ?? m.id}${m.period === "P28D" ? ", last 28 days" : ""}`;
      facts.push(fact(known?.kind ?? (money ? "billing" : "usage"), known?.metric ?? `rc_${m.id}`, label, money ? `${value.toFixed(2)} ${currency}` : value.toLocaleString("en-US"), value, money ? currency : (known?.unit ?? null), null, { url: `${page}/overview`, ...(m.description ? { note: m.description } : {}) }));
    }
    facts.push(fact("status", "not_reported", "Not in RevenueCat's API", "The plan. RevenueCat bills on monthly tracked revenue, which the checked limits list tracks against the revenue above.", null, null, null, { url: "https://www.revenuecat.com/pricing/" }));
    return facts;
  },
};

/* -------------------------------------------------------------- GitHub */

const GH_API = "https://api.github.com";
const CONCLUSION_WORDS: Record<string, string> = { success: "passed", failure: "failed", cancelled: "was cancelled", timed_out: "timed out", action_required: "needs action", neutral: "ended neutral", skipped: "was skipped", stale: "went stale", startup_failure: "failed to start" };
const FAILED_CONCLUSIONS = new Set(["failure", "timed_out", "startup_failure"]);

function ghHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, "x-github-api-version": "2022-11-28", "user-agent": "birdsI" };
}

function bySeverity(counts: Map<string, number>): string {
  return ["critical", "high", "medium", "low"]
    .filter((s) => counts.get(s))
    .map((s) => `${counts.get(s)} ${s}`)
    .join(", ");
}

function seriousCount(counts: Map<string, number>): number {
  return (counts.get("critical") ?? 0) + (counts.get("high") ?? 0);
}

const github: Connector = {
  slug: "github",
  name: "GitHub",
  tokenHint: "A fine-grained personal access token for this repository, read only: Metadata, Actions, Dependabot alerts, Secret scanning alerts, Code scanning alerts, and the account permission Plan.",
  tokenUrl: "https://github.com/settings/personal-access-tokens/new",
  fields: [{ key: "repo", label: "Repository", hint: "owner/name", required: true }],
  async probe(token, settings, signal) {
    const repo = settings["repo"]?.trim() ?? "";
    const [owner, name] = repo.split("/");
    if (!owner || !name) throw new Error("A GitHub key reads one repository: add it as owner/name.");
    const headers = ghHeaders(token);
    const base = `${GH_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
    const repository = await getJson<{ private?: boolean; archived?: boolean; default_branch?: string; pushed_at?: string; open_issues_count?: number; html_url?: string }>(base, headers, signal);
    if (repository.status === 404) throw new Error(`GitHub shows no repository ${repo} to this token. A fine-grained token sees only the repositories it was made for.`);
    if (repository.status >= 400) unauthorized(repository.status, "GitHub");
    const r = repository.body ?? {};
    const branch = r.default_branch ?? "main";
    const htmlUrl = r.html_url ?? `https://github.com/${repo}`;
    const facts: ConnectorFact[] = [fact("status", "repository", "Repository", `${r.private ? "Private" : "Public"}${r.archived ? ", archived" : ""}, default branch ${branch}${r.pushed_at ? `, last push ${dayWords(r.pushed_at)}` : ""}`, null, null, null, { url: htmlUrl })];
    if (typeof r.open_issues_count === "number") facts.push(fact("usage", "open_issues", "Open issues and pull requests", String(r.open_issues_count), r.open_issues_count, "issues", null, { url: `${htmlUrl}/issues` }));

    // The newest completed workflow run on the default branch.
    const runs = await getJson<{ workflow_runs?: Array<{ name?: string; status?: string; conclusion?: string | null; html_url?: string; updated_at?: string; run_started_at?: string }> }>(`${base}/actions/runs?branch=${encodeURIComponent(branch)}&per_page=10&exclude_pull_requests=true`, headers, signal);
    if (runs.status < 400) {
      const newest = (runs.body?.workflow_runs ?? []).find((w) => w.status === "completed");
      if (!newest) facts.push(fact("status", "ci_latest", "Actions", `No completed workflow run on ${branch}.`, null, null, null, { url: `${htmlUrl}/actions` }));
      else {
        const words = CONCLUSION_WORDS[newest.conclusion ?? ""] ?? `ended ${newest.conclusion ?? "without a conclusion"}`;
        const when = dayWords(newest.updated_at ?? newest.run_started_at);
        const url = newest.html_url ?? `${htmlUrl}/actions`;
        facts.push(fact("status", "ci_latest", "Actions", `${newest.name ?? "A workflow"} on ${branch} ${words}${when ? ` on ${when}` : ""}`, null, null, null, { url }));
        if (FAILED_CONCLUSIONS.has(newest.conclusion ?? "")) facts.push(fact("status", "ci_failed", "Actions, failed run", `The newest run of ${newest.name ?? "a workflow"} on ${branch} of ${repo} ${words}${when ? ` on ${when}` : ""}`, 1, null, null, { url }));
      }
    } else facts.push(fact("status", "actions_access", "Actions", runs.status === 403 || runs.status === 404 ? "Not read: give the token Actions: read on this repository." : `Not read: GitHub answered HTTP ${runs.status}.`, null, null, null, { url: `${htmlUrl}/actions` }));

    // Open Dependabot alerts, by severity.
    const dep = await getJson<Array<{ security_vulnerability?: { severity?: string }; security_advisory?: { severity?: string }; dependency?: { package?: { name?: string } } }> | { message?: string }>(`${base}/dependabot/alerts?state=open&per_page=100`, headers, signal);
    if (dep.status < 400 && Array.isArray(dep.body)) {
      const counts = new Map<string, number>();
      const packages: string[] = [];
      for (const a of dep.body) {
        const s = (a.security_vulnerability?.severity ?? a.security_advisory?.severity ?? "unknown").toLowerCase();
        counts.set(s, (counts.get(s) ?? 0) + 1);
        const pkg = a.dependency?.package?.name;
        if ((s === "critical" || s === "high") && pkg && !packages.includes(pkg)) packages.push(pkg);
      }
      const total = dep.body.length;
      facts.push(fact("usage", "dependabot_open", "Dependabot alerts open", total === 0 ? "None" : `${total} open: ${bySeverity(counts)}${total >= 100 ? " (the first 100)" : ""}`, total, "alerts", null, { url: `${htmlUrl}/security/dependabot` }));
      const serious = seriousCount(counts);
      if (serious > 0) facts.push(fact("usage", "dependabot_serious", "Dependabot alerts, critical or high", `${serious} open: ${packages.slice(0, 5).join(", ")}${packages.length > 5 ? ` and ${packages.length - 5} more` : ""}`, serious, "alerts", null, { url: `${htmlUrl}/security/dependabot` }));
    } else {
      const said = !Array.isArray(dep.body) && typeof dep.body?.message === "string" ? dep.body.message : null;
      facts.push(fact("status", "dependabot_access", "Dependabot alerts", dep.status === 403 || dep.status === 404 ? `Not read: ${said ?? "Dependabot alerts are off for the repository, or the token lacks Dependabot alerts: read."}` : `Not read: GitHub answered HTTP ${dep.status}.`, null, null, null, { url: `${htmlUrl}/settings/security_analysis` }));
    }

    // Open secret scanning alerts: a 404 means the feature is off for the repository.
    const secrets = await getJson<Array<{ secret_type_display_name?: string; secret_type?: string }> | { message?: string }>(`${base}/secret-scanning/alerts?state=open&per_page=100`, headers, signal);
    if (secrets.status < 400 && Array.isArray(secrets.body)) {
      const types = [...new Set(secrets.body.map((a) => a.secret_type_display_name ?? a.secret_type ?? "secret"))];
      const n = secrets.body.length;
      facts.push(fact("usage", "secrets_open", "Secret scanning alerts open", n === 0 ? "None" : `${n} open: ${types.slice(0, 5).join(", ")}`, n, "alerts", null, { url: `${htmlUrl}/security/secret-scanning` }));
    } else {
      facts.push(fact("status", "secret_scanning_access", "Secret scanning", secrets.status === 404 ? "Not read: secret scanning is off for this repository (GitHub turns it on for public repositories, Advanced Security does for private ones), or the token lacks Secret scanning alerts: read." : secrets.status === 403 ? "Not read: the token must belong to an administrator of the repository, with Secret scanning alerts: read." : `Not read: GitHub answered HTTP ${secrets.status}.`, null, null, null, { url: `${htmlUrl}/settings/security_analysis` }));
    }

    // Open code scanning alerts: a 403 means Advanced Security is off, a 404 that nothing has analysed the code.
    const code = await getJson<Array<{ rule?: { security_severity_level?: string | null; severity?: string | null } }> | { message?: string }>(`${base}/code-scanning/alerts?state=open&per_page=100`, headers, signal);
    if (code.status < 400 && Array.isArray(code.body)) {
      const counts = new Map<string, number>();
      for (const a of code.body) {
        const s = (a.rule?.security_severity_level ?? a.rule?.severity ?? "unknown").toLowerCase();
        counts.set(s, (counts.get(s) ?? 0) + 1);
      }
      const n = code.body.length;
      facts.push(fact("usage", "code_scanning_open", "Code scanning alerts open", n === 0 ? "None" : `${n} open: ${bySeverity(counts) || "severity not rated"}`, n, "alerts", null, { url: `${htmlUrl}/security/code-scanning` }));
      const serious = seriousCount(counts);
      if (serious > 0) facts.push(fact("usage", "code_scanning_serious", "Code scanning alerts, critical or high", `${serious} open`, serious, "alerts", null, { url: `${htmlUrl}/security/code-scanning` }));
    } else {
      facts.push(fact("status", "code_scanning_access", "Code scanning", code.status === 403 ? "Not read: code scanning needs GitHub Advanced Security on this repository." : code.status === 404 ? "Not read: no code scanning analysis yet, or the token lacks Code scanning alerts: read." : `Not read: GitHub answered HTTP ${code.status}.`, null, null, null, { url: `${htmlUrl}/security/code-scanning` }));
    }

    // The account's plan and usage this month, from the billing usage report. The whole account, not one repository.
    const me = await getJson<{ login?: string; plan?: { name?: string } }>(`${GH_API}/user`, headers, signal);
    const planName = me.status < 400 ? me.body?.plan?.name : undefined;
    if (planName) facts.push(fact("plan", "plan", "Plan", planName.charAt(0).toUpperCase() + planName.slice(1), null, null, null, { url: "https://github.com/settings/billing" }));
    const login = me.status < 400 ? me.body?.login : undefined;
    const now = new Date();
    const usage = login ? await getJson<{ usageItems?: Array<{ product?: string; unitType?: string; quantity?: number; netAmount?: number }> }>(`${GH_API}/users/${encodeURIComponent(login)}/settings/billing/usage?year=${now.getUTCFullYear()}&month=${now.getUTCMonth() + 1}`, headers, signal) : null;
    if (usage && usage.status < 400 && Array.isArray(usage.body?.usageItems)) {
      let spend = 0;
      let minutes = 0;
      for (const item of usage.body.usageItems) {
        spend += Number(item.netAmount ?? 0) || 0;
        if (/actions/i.test(item.product ?? "") && /minute/i.test(item.unitType ?? "")) minutes += Number(item.quantity ?? 0) || 0;
      }
      facts.push(fact("cost", "spend_month", "Spend this month", `$${spend.toFixed(2)}`, Math.round(spend * 100) / 100, "USD", null, { url: "https://github.com/settings/billing", note: "The account's usage this month after discounts, from GitHub's billing usage report: Actions, storage, Copilot and the rest, across every repository." }));
      facts.push(fact("usage", "actions_minutes_month", "Actions minutes this month", Math.round(minutes).toLocaleString("en-US"), Math.round(minutes), "minutes", null, { url: "https://github.com/settings/billing", note: "Across the account's repositories, as the plan counts them." }));
    } else {
      facts.push(fact("status", "billing_access", "Usage this month", "Not read: the account's usage needs the token's Plan: read permission, on an account with GitHub's enhanced billing platform.", null, null, null, { url: "https://github.com/settings/billing" }));
    }
    return facts;
  },
};

/* --------------------------------------------------- App Store Connect */

const ASC_API = "https://api.appstoreconnect.apple.com/v1";
/** Apple rejects a token that lives longer than 20 minutes. One is made per read. */
const APPLE_TOKEN_SECONDS = 15 * 60;
const PLATFORM_WORDS: Record<string, string> = { IOS: "iOS", MAC_OS: "macOS", TV_OS: "tvOS", VISION_OS: "visionOS" };
const VERSION_STATE_WORDS: Record<string, string> = {
  ACCEPTED: "accepted",
  DEVELOPER_REJECTED: "withdrawn by you",
  IN_REVIEW: "in review",
  INVALID_BINARY: "invalid binary",
  METADATA_REJECTED: "metadata rejected",
  PENDING_APPLE_RELEASE: "approved, Apple releases it",
  PENDING_DEVELOPER_RELEASE: "approved, waiting for you to release it",
  PREPARE_FOR_SUBMISSION: "being prepared",
  PROCESSING_FOR_DISTRIBUTION: "processing for distribution",
  READY_FOR_DISTRIBUTION: "live",
  READY_FOR_REVIEW: "ready for review",
  REJECTED: "rejected",
  REPLACED_WITH_NEW_VERSION: "replaced",
  WAITING_FOR_EXPORT_COMPLIANCE: "waiting for export compliance",
  WAITING_FOR_REVIEW: "waiting for review",
};
const REJECTED_STATES = new Set(["REJECTED", "METADATA_REJECTED", "INVALID_BINARY"]);
const BUILD_STATE_WORDS: Record<string, string> = { PROCESSING: "processing", FAILED: "failed to process", INVALID: "invalid", VALID: "processed" };

/** The .p8 file's text as a PEM key, whatever happened to its line breaks on the way. */
function p8ToPem(text: string): string {
  const body = text.replace(/-----(BEGIN|END)[A-Z ]*PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  if (body.length < 40 || !/^[A-Za-z0-9+/=]+$/.test(body)) throw new Error("Paste the text of the .p8 key file: it starts with BEGIN PRIVATE KEY.");
  return `-----BEGIN PRIVATE KEY-----\n${body.match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----\n`;
}

/** A signed token for App Store Connect: ES256, the key id in the header, the issuer for a team key or the subject "user" for an individual key. */
export function appleToken(input: { keyId: string; issuerId: string | null; privateKey: string; now?: number }): string {
  const header = { alg: "ES256", kid: input.keyId, typ: "JWT" };
  const iat = Math.floor((input.now ?? Date.now()) / 1000);
  const payload = { ...(input.issuerId ? { iss: input.issuerId } : { sub: "user" }), iat, exp: iat + APPLE_TOKEN_SECONDS, aud: "appstoreconnect-v1" };
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const signingInput = `${part(header)}.${part(payload)}`;
  let key: KeyObject;
  try {
    key = createPrivateKey(p8ToPem(input.privateKey));
  } catch (error) {
    throw error instanceof Error && /\.p8/.test(error.message) ? error : new Error("The key could not be read. Paste the whole text of the .p8 file.");
  }
  const signature = sign("sha256", Buffer.from(signingInput), { key, dsaEncoding: "ieee-p1363" }).toString("base64url");
  return `${signingInput}.${signature}`;
}

interface AscVersion {
  attributes?: { platform?: string; versionString?: string; appVersionState?: string; appStoreState?: string; createdDate?: string };
}
interface AscBuild {
  attributes?: { version?: string; uploadedDate?: string; processingState?: string; expired?: boolean };
}

const apple: Connector = {
  slug: "apple",
  name: "App Store Connect",
  tokenHint: "The App Store Connect API key's .p8 file, pasted as text. Apple keys cannot be made read only, so birdsI only reads with it.",
  tokenUrl: "https://appstoreconnect.apple.com/access/integrations/api",
  fields: [
    { key: "appId", label: "Apple ID of the app", hint: "App Store Connect > the app > App Information > Apple ID (digits).", required: true },
    { key: "keyId", label: "Key ID", hint: "Shown next to the key under Users and Access > Integrations > App Store Connect API.", required: true },
    { key: "issuerId", label: "Issuer ID", hint: "Shown above the team keys. Leave empty for an individual key.", required: false },
    { key: "bundleId", label: "Bundle id", hint: "Checked against the app when set.", required: false },
  ],
  async probe(token, settings, signal) {
    const appId = settings["appId"]?.trim();
    const keyId = settings["keyId"]?.trim();
    const issuerId = settings["issuerId"]?.trim() || null;
    if (!appId) throw new Error("An App Store Connect key reads one app: add the app's Apple ID.");
    if (!keyId) throw new Error("Add the Key ID: it is shown next to the key under Users and Access > Integrations > App Store Connect API.");
    const auth = { authorization: `Bearer ${appleToken({ keyId, issuerId, privateKey: token })}` };
    const id = encodeURIComponent(appId);
    const field = (name: string) => encodeURIComponent(name);
    const app = await getJson<{ data?: { attributes?: { name?: string; bundleId?: string; sku?: string } } }>(`${ASC_API}/apps/${id}?${field("fields[apps]")}=name,bundleId,sku`, auth, signal);
    if (app.status === 401) throw new Error("App Store Connect did not accept the key. Check the Key ID, the Issuer ID (empty for an individual key), and that the key was not revoked.");
    if (app.status === 403) throw new Error("App Store Connect refused the key for this app. The key's role must be able to see the app (Developer or App Manager, with access to it).");
    if (app.status === 404) throw new Error(`App Store Connect shows no app with Apple ID ${appId} to this key's team.`);
    if (app.status >= 400) unauthorized(app.status, "App Store Connect");
    const attrs = app.body?.data?.attributes ?? {};
    const wantedBundle = settings["bundleId"]?.trim();
    if (wantedBundle && attrs.bundleId && attrs.bundleId !== wantedBundle) throw new Error(`The app's bundle id is ${attrs.bundleId}, not ${wantedBundle}. Check the project's bundle id.`);
    const page = `https://appstoreconnect.apple.com/apps/${id}/distribution`;
    const testflight = `https://appstoreconnect.apple.com/apps/${id}/testflight`;
    const facts: ConnectorFact[] = [fact("status", "app", "App", `${attrs.name ?? appId}${attrs.bundleId ? ` (${attrs.bundleId})` : ""}`, null, null, null, { url: page })];

    const versions = await getJson<{ data?: AscVersion[] }>(`${ASC_API}/apps/${id}/appStoreVersions?${field("fields[appStoreVersions]")}=platform,versionString,appVersionState,createdDate&limit=20`, auth, signal);
    if (versions.status < 400) {
      const list = (versions.body?.data ?? [])
        .map((v) => ({ platform: PLATFORM_WORDS[v.attributes?.platform ?? ""] ?? v.attributes?.platform ?? "", version: v.attributes?.versionString ?? "?", state: v.attributes?.appVersionState ?? v.attributes?.appStoreState ?? "UNKNOWN", createdAt: v.attributes?.createdDate ?? "" }))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const label = (v: { version: string; platform: string }) => `${v.version}${v.platform ? ` on ${v.platform}` : ""}`;
      const stateWords = (state: string) => VERSION_STATE_WORDS[state] ?? state.toLowerCase().replace(/_/g, " ");
      const live = [...new Map(list.filter((v) => v.state === "READY_FOR_DISTRIBUTION").map((v) => [v.platform, v])).values()];
      facts.push(fact("status", "live_version", "Live on the App Store", live.length > 0 ? live.map(label).join(", ") : "No version is live.", null, null, null, { url: page }));
      const inProgress = list.find((v) => v.state !== "READY_FOR_DISTRIBUTION" && v.state !== "REPLACED_WITH_NEW_VERSION");
      if (inProgress) facts.push(fact("status", "version_in_progress", "Version in progress", `${label(inProgress)}, ${stateWords(inProgress.state)}`, null, null, null, { url: page }));
      const rejected = list.filter((v) => REJECTED_STATES.has(v.state));
      if (rejected.length > 0) facts.push(fact("status", "version_rejected", "Rejected by App Review", rejected.map((v) => `${label(v)}, ${stateWords(v.state)}`).join(". "), rejected.length, null, null, { url: page }));
    } else {
      facts.push(fact("status", "versions_access", "Versions", `Not read: App Store Connect answered HTTP ${versions.status} for the app's versions.`, null, null, null, { url: page }));
    }

    const buildsPath = `${ASC_API}/apps/${id}/builds?${field("fields[builds]")}=version,uploadedDate,processingState,expired`;
    let builds = await getJson<{ data?: AscBuild[] }>(`${buildsPath}&sort=-uploadedDate&limit=5`, auth, signal);
    if (builds.status === 400) builds = await getJson<{ data?: AscBuild[] }>(`${buildsPath}&limit=200`, auth, signal);
    if (builds.status < 400) {
      const newest = (builds.body?.data ?? [])
        .map((b) => ({ version: b.attributes?.version ?? "?", uploadedAt: b.attributes?.uploadedDate ?? "", state: b.attributes?.processingState ?? "UNKNOWN" }))
        .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))[0];
      if (!newest) facts.push(fact("status", "latest_build", "Newest build", "No build uploaded yet.", null, null, null, { url: testflight }));
      else {
        const words = `Build ${newest.version}${newest.uploadedAt ? `, uploaded ${dayWords(newest.uploadedAt)}` : ""} (${BUILD_STATE_WORDS[newest.state] ?? newest.state.toLowerCase()})`;
        facts.push(fact("status", "latest_build", "Newest build", words, null, null, null, { url: testflight }));
        if (newest.state === "FAILED" || newest.state === "INVALID") facts.push(fact("status", "build_failed", "Build did not process", words, 1, null, null, { url: testflight }));
      }
    } else {
      facts.push(fact("status", "builds_access", "Builds", `Not read: App Store Connect answered HTTP ${builds.status} for the app's builds.`, null, null, null, { url: testflight }));
    }
    facts.push(fact("status", "not_reported", "Not read from App Store Connect", "The Developer Program membership's renewal date (enter it under Dates to watch) and sales, which need the Finance role and are not read yet.", null, null, null, { url: "https://developer.apple.com/account" }));
    return facts;
  },
};

export const CONNECTORS: readonly Connector[] = [vercel, supabase, onesignal, stripe, anthropic, tavilyConnector, supadata, resend, clerk, revenuecat, github, apple];
export const CONNECTOR_BY_SLUG = new Map(CONNECTORS.map((c) => [c.slug, c]));

/** The public shape of a connector, for the UI. */
export function connectorInfo(): Array<Pick<Connector, "slug" | "name" | "tokenHint" | "tokenUrl" | "fields">> {
  return CONNECTORS.map((c) => ({ slug: c.slug, name: c.name, tokenHint: c.tokenHint, tokenUrl: c.tokenUrl, fields: c.fields }));
}

/**
 * The settings a connector reads a project with, from the project's own
 * identifiers: a Vercel team, a Supabase project ref or organization, a
 * Clerk instance, a RevenueCat project, a GitHub repository, an App Store
 * Connect app with its key id and issuer.
 */
export function settingsForProject(project: { vendor: string; kind: string; ref: string; settings: Record<string, string> }): Record<string, string> {
  if (project.vendor === "vercel") {
    const team = project.settings["team"]?.trim() ?? (project.kind === "team" ? project.ref : "");
    return { ...(team ? { teamId: team } : {}), ...(project.kind === "project" ? { project: project.ref } : {}) };
  }
  if (project.vendor === "supabase") return project.kind === "project" ? { projectRef: project.ref } : { orgSlug: project.ref };
  if (project.vendor === "onesignal") return { appId: project.ref };
  if (project.vendor === "clerk") return withValues({ instanceId: project.ref, application: project.settings["application"] });
  if (project.vendor === "revenuecat") return { projectId: project.ref };
  if (project.vendor === "github") return { repo: project.ref };
  if (project.vendor === "apple") return withValues({ appId: project.ref, keyId: project.settings["keyId"], issuerId: project.settings["issuerId"], bundleId: project.settings["bundleId"] });
  return { ...project.settings };
}

function withValues(settings: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(settings).filter((e): e is [string, string] => typeof e[1] === "string" && e[1].trim() !== "").map(([k, v]) => [k, v.trim()]));
}
