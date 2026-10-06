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

const vercel: Connector = {
  slug: "vercel",
  name: "Vercel",
  tokenHint: "An access token with read scope on the team.",
  tokenUrl: "https://vercel.com/account/settings/tokens",
  fields: [{ key: "teamId", label: "Team id", hint: "Settings > General > Team ID. Leave empty for a personal account.", required: false }],
  async probe(token, settings, signal) {
    const auth = { authorization: `Bearer ${token}` };
    const facts: ConnectorFact[] = [];
    const teamId = settings["teamId"]?.trim();
    if (teamId) {
      const team = await getJson<{ billing?: { plan?: string }; resourceConfig?: Record<string, unknown>; name?: string }>(`https://api.vercel.com/v2/teams/${encodeURIComponent(teamId)}`, auth, signal);
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
        if (lines > 0) facts.push(fact("cost", "spend_month", "Spend this month", `$${total.toFixed(2)}`, Math.round(total * 100) / 100, "USD", null, { note: "From Vercel's billing charges for the current month." }));
      } else if (charges.status !== 403 && charges.status !== 404) {
        facts.push(fact("status", "billing_access", "Billing data", `Vercel answered HTTP ${charges.status} for billing charges.`));
      } else {
        facts.push(fact("status", "billing_access", "Billing data", "Spend is available through the API on Pro and Enterprise teams only."));
      }
    } else {
      const me = await getJson<{ user?: { username?: string; email?: string } }>("https://api.vercel.com/v2/user", auth, signal);
      if (me.status >= 400) unauthorized(me.status, "Vercel");
      facts.push(fact("plan", "plan", "Plan", "Hobby", null, null, null, { note: "Personal accounts are on the Hobby plan. Add the team id to read a team's plan and spend." }));
      if (me.body?.user?.username) facts.push(fact("status", "account", "Account", me.body.user.username));
    }
    const projects = await getJson<{ projects?: Array<{ name: string }> }>(`https://api.vercel.com/v9/projects?limit=100${teamId ? `&teamId=${encodeURIComponent(teamId)}` : ""}`, auth, signal);
    if (projects.status < 400 && projects.body?.projects) facts.push(fact("usage", "projects", "Projects", String(projects.body.projects.length), projects.body.projects.length, "projects"));
    return facts;
  },
};

/** Plan allowances from supabase.com/pricing, read 2026-10. Re-check when Supabase changes its plans. */
const SUPABASE_ALLOWANCES: Record<string, { dbMb: number; storageGb: number; mau: number; egressGb: number }> = {
  free: { dbMb: 500, storageGb: 1, mau: 50_000, egressGb: 5 },
  pro: { dbMb: 8_192, storageGb: 100, mau: 100_000, egressGb: 250 },
  team: { dbMb: 8_192, storageGb: 100, mau: 100_000, egressGb: 250 },
};

async function supabaseQuery(token: string, ref: string, query: string, signal?: AbortSignal): Promise<Record<string, unknown> | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  signal?.addEventListener("abort", () => controller.abort(), { once: true });
  try {
    const response = await fetch(`https://api.supabase.com/v1/projects/${encodeURIComponent(ref)}/database/query`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ query }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const body = (await response.json()) as unknown;
    const rows = Array.isArray(body) ? body : body && typeof body === "object" && Array.isArray((body as { data?: unknown }).data) ? (body as { data: unknown[] }).data : [];
    const first = rows[0];
    return first && typeof first === "object" ? (first as Record<string, unknown>) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const supabase: Connector = {
  slug: "supabase",
  name: "Supabase",
  tokenHint: "A personal access token from your Supabase account. It is used to read the plan and to run three read-only size and count queries on the project.",
  tokenUrl: "https://supabase.com/dashboard/account/tokens",
  fields: [
    { key: "projectRef", label: "Project ref", hint: "The project's reference id, from its URL: supabase.com/dashboard/project/<ref>. Leave empty and birdsI reads up to three active projects.", required: false },
    { key: "orgSlug", label: "Organization slug", hint: "From the organization's URL: supabase.com/dashboard/org/<slug>. Leave empty to use the first organization.", required: false },
  ],
  async probe(token, settings, signal) {
    const auth = { authorization: `Bearer ${token}` };
    const facts: ConnectorFact[] = [];
    const orgs = await getJson<Array<{ id: string; slug?: string; name: string; plan?: string }>>("https://api.supabase.com/v1/organizations", auth, signal);
    if (orgs.status >= 400) unauthorized(orgs.status, "Supabase");
    const list = orgs.body ?? [];
    const wanted = settings["orgSlug"]?.trim();
    const org = (wanted ? list.find((o) => o.slug === wanted || o.id === wanted) : list[0]) ?? null;
    if (!org) throw new Error(wanted ? `No Supabase organization named ${wanted} is visible to this token.` : "This token sees no Supabase organizations.");
    let plan = org.plan ?? null;
    if (!plan && org.slug) {
      const detail = await getJson<{ plan?: string }>(`https://api.supabase.com/v1/organizations/${encodeURIComponent(org.slug)}`, auth, signal);
      plan = detail.body?.plan ?? null;
    }
    const planKey = (plan ?? "").toLowerCase();
    const allowance = SUPABASE_ALLOWANCES[planKey] ?? null;
    if (plan) facts.push(fact("plan", "plan", "Plan", plan.charAt(0).toUpperCase() + plan.slice(1), null, null, null, { url: "https://supabase.com/pricing" }));
    facts.push(fact("status", "organization", "Organization", org.name));

    const projects = await getJson<Array<{ id: string; name: string; status?: string; region?: string; organization_id?: string }>>("https://api.supabase.com/v1/projects", auth, signal);
    const mine = (projects.status < 400 && projects.body ? projects.body : []).filter((p) => !p.organization_id || p.organization_id === org.id);
    facts.push(fact("usage", "projects", "Projects", String(mine.length), mine.length, "projects"));
    const paused = mine.filter((p) => /pause|inactive/i.test(p.status ?? ""));
    if (paused.length > 0) facts.push(fact("status", "paused_projects", "Paused projects", paused.map((p) => p.name).join(", "), paused.length, "projects", null, { note: "Free projects pause after a week without traffic." }));

    // Real usage: three read-only queries on the project itself, through the Management API.
    const wantedRef = settings["projectRef"]?.trim();
    const targets = (wantedRef ? mine.filter((p) => p.id === wantedRef) : mine.filter((p) => /active|healthy/i.test(p.status ?? "active"))).slice(0, 3);
    const many = targets.length > 1;
    const note = "Read from the project with a read-only query through Supabase's Management API.";
    let readAny = false;
    for (const project of targets) {
      const suffix = many ? `:${project.id}` : "";
      const label = many ? ` (${project.name})` : "";
      const db = await supabaseQuery(token, project.id, "select pg_database_size(current_database())::bigint as bytes", signal);
      const dbBytes = db ? Number(db["bytes"]) : NaN;
      if (Number.isFinite(dbBytes)) {
        const mb = Math.round((dbBytes / 1_048_576) * 10) / 10;
        facts.push(fact("usage", `db_size_mb${suffix}`, `Database size${label}`, allowance ? `${mb} MB of ${allowance.dbMb} MB` : `${mb} MB`, mb, "MB", allowance?.dbMb ?? null, { note }));
        readAny = true;
      }
      const storage = await supabaseQuery(token, project.id, "select coalesce(sum((metadata->>'size')::bigint), 0)::bigint as bytes from storage.objects", signal);
      const storageBytes = storage ? Number(storage["bytes"]) : NaN;
      if (Number.isFinite(storageBytes)) {
        const gb = Math.round((storageBytes / 1_073_741_824) * 100) / 100;
        facts.push(fact("usage", `storage_gb${suffix}`, `File storage${label}`, allowance ? `${gb} GB of ${allowance.storageGb} GB` : `${gb} GB`, gb, "GB", allowance?.storageGb ?? null, { note }));
        readAny = true;
      }
      const mau = await supabaseQuery(token, project.id, "select count(*)::bigint as n from auth.users where last_sign_in_at > now() - interval '30 days'", signal);
      const n = mau ? Number(mau["n"]) : NaN;
      if (Number.isFinite(n)) {
        facts.push(fact("usage", `mau${suffix}`, `Active users, 30 days${label}`, allowance ? `${n.toLocaleString("en-US")} of ${allowance.mau.toLocaleString("en-US")}` : n.toLocaleString("en-US"), n, "users", allowance?.mau ?? null, { note }));
        readAny = true;
      }
    }
    if (allowance) {
      facts.push(fact("limit", "egress_gb", "Egress included", `${allowance.egressGb} GB a month`, allowance.egressGb, "GB", null, { url: "https://supabase.com/pricing", note: "Egress is not readable by query; the dashboard's usage page has it." }));
    }
    if (!readAny) {
      facts.push(fact("status", "usage_access", "Usage data", targets.length === 0 ? "No active project to read. Set the project ref in the connection." : "The token could not run read-only queries on the project. Database size, storage and active users are on the dashboard's usage page.", null, null, null, { url: "https://supabase.com/dashboard/org/_/usage" }));
    }
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
  tokenHint: "A restricted key with read access to Balance and Charges.",
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
    const charges = await getJson<{ data?: Array<{ amount: number; currency: string; paid: boolean; refunded: boolean }> }>(`https://api.stripe.com/v1/charges?limit=100&created[gte]=${since}`, auth, signal);
    if (charges.status < 400 && charges.body?.data) {
      const paid = charges.body.data.filter((c) => c.paid && !c.refunded);
      const revenue = paid.reduce((n, c) => n + c.amount, 0) / 100;
      facts.push(fact("billing", "revenue_month", "Revenue this month", `${revenue.toFixed(2)} ${currency}${charges.body.data.length === 100 ? " (first 100 charges)" : ""}`, revenue, currency, null, { note: "Paid, unrefunded charges created this month." }));
      facts.push(fact("usage", "charges_month", "Charges this month", String(paid.length), paid.length, "charges"));
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
    if (cached > 0) facts.push(fact("usage", "cached_tokens_month", "Cached input tokens this month", cached.toLocaleString("en-US"), cached, "tokens", null, { note: "Read from or written to the prompt cache; billed at the cache rates." }));
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
    if (facts.length === 0) facts.push(fact("status", "account", "Account", "Connected. Resend reports quota in response headers after sends; none were present on this call."));
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

export const CONNECTORS: readonly Connector[] = [vercel, supabase, stripe, anthropic, tavilyConnector, supadata, resend];
export const CONNECTOR_BY_SLUG = new Map(CONNECTORS.map((c) => [c.slug, c]));

/** The public shape of a connector, for the UI. */
export function connectorInfo(): Array<Pick<Connector, "slug" | "name" | "tokenHint" | "tokenUrl" | "fields">> {
  return CONNECTORS.map((c) => ({ slug: c.slug, name: c.name, tokenHint: c.tokenHint, tokenUrl: c.tokenUrl, fields: c.fields }));
}
