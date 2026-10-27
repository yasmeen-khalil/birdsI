import { z } from "zod";
import { AlertEmailState } from "./alerts";
import { PROJECT_VENDOR_BY_SLUG, type AppProject, type UntiedKey } from "./apps";
import type { ScanScope } from "./domain";
import { readsInDepth } from "./reads";
import type { StoredMap } from "./map";

/**
 * What birdsI still needs from the owner for one app, as a checklist built
 * from the map: each service with the key that reads it, the exact clicks,
 * what birdsI will do once it is connected, and what it may do at all.
 * Pure, so the page, the terminal and agents show the same list.
 */

export const ChecklistStatus = z.enum(["done", "todo", "failed", "blocked", "optional"]);
export type ChecklistStatus = z.infer<typeof ChecklistStatus>;

export const ChecklistItem = z.object({
  id: z.string(),
  group: z.string(),
  title: z.string(),
  status: ChecklistStatus,
  /** Counts toward the cockpit being complete. */
  required: z.boolean(),
  /** Where it stands, in one sentence. */
  state: z.string(),
  /** The exact clicks, in order. Empty when it is done. */
  steps: z.array(z.string()),
  /** What birdsI will do once this is done. */
  willDo: z.string().nullable(),
  links: z.array(z.object({ label: z.string(), url: z.string() })),
  /** The page under the app where it is done, or null when it happens elsewhere (the terminal, the birdsI deployment). */
  where: z.string().nullable(),
});
export type ChecklistItem = z.infer<typeof ChecklistItem>;

export const ChecklistView = z.object({
  appName: z.string(),
  items: z.array(ChecklistItem),
  required: z.object({ done: z.number().int(), total: z.number().int() }),
  optional: z.object({ done: z.number().int(), total: z.number().int() }),
  /** True when every required step is done. */
  complete: z.boolean(),
  /** What birdsI may do with what you connect, said once. */
  mayDo: z.string(),
});
export type ChecklistView = z.infer<typeof ChecklistView>;

export const ChecklistResponse = z.object({ checklist: ChecklistView });
export type ChecklistResponse = z.infer<typeof ChecklistResponse>;

export const MAY_DO = "In this phase birdsI only reads. Every key is read only where the vendor offers one, each key is checked with the vendor before it is kept, stored encrypted, and never shown again. birdsI never changes anything at a vendor: no deploy, no env change, no send, no refund. Writes come in a later phase, each behind your approval and a log. Your coding agent can propose a command, and only you approve it, in the browser.";

export interface VendorAbility {
  /** What birdsI reads once a key is connected. */
  reads: string;
  /** What it alerts on from those reads. */
  alerts: string;
  /** The exact clicks to make the key, in order. */
  keySteps: string[];
}

/** Per vendor birdsI can read: what it will read, what it will alert on, and the clicks for the key. */
export const VENDOR_ABILITIES: Record<string, VendorAbility> = {
  vercel: {
    reads: "The newest deployments and their state, the env names set per environment (never a value), the crons registered and whether they are on, the domains, the error lines of a failed build and of the live functions, and with a team token the plan and this month's charges.",
    alerts: "A failed production deployment, an env name the code needs that the project lacks, a cron not registered or switched off, a cron above the plan's runs a day, a key about to expire.",
    keySteps: [
      "vercel.com > your avatar > Account Settings > Tokens > Create Token.",
      "Scope: the team that owns the project. A token scoped to this one project also works, without the plan and spend. Expiration: 90 days or longer, and birdsI warns before it ends.",
      "Paste it on Projects > the Vercel project > Connect key.",
    ],
  },
  supabase: {
    reads: "Whether the project is paused, the database size against the plan, the security and performance advisors, and which of the app's migrations the database still owes, from the markers in the app's own verify.sql. Never a row of the app's tables.",
    alerts: "A paused project, a database near the plan's limit, a migration owed, a key that stopped working.",
    keySteps: [
      "supabase.com/dashboard/account/tokens > Generate new token > a scoped token, not a legacy one.",
      "Resources: this one project. Permissions, all Read: Project Settings, Advisors, Database, Migrations, and Organization Settings for the plan.",
      "Paste it on Projects > the Supabase project > Connect key.",
    ],
  },
  onesignal: {
    reads: "Subscriptions and how many are subscribed, the platforms set up, whether mobile push is being dropped for the plan, and the recent messages with their delivery counts. Campaign names only, never a message's text.",
    alerts: "Mobile push dropped for the plan, a key that stopped working.",
    keySteps: ["dashboard.onesignal.com > the app > Settings > Keys and IDs > Add Key: an App API key.", "Leave the IP allowlist off: birdsI's worker has no fixed address.", "Paste it on Projects > the OneSignal app > Connect key."],
  },
  clerk: {
    reads: "Whether the key belongs to the declared instance, the instance's environment, and the users and organizations as Clerk counts them. Never a user's data. The plan and the monthly retained users it is billed on are not in Clerk's API.",
    alerts: "A key that stopped working.",
    keySteps: ["dashboard.clerk.com > the application > Configure > API keys > Secret keys: copy this instance's key (sk_live_ for production, sk_test_ for development). Clerk has no read-only key, so birdsI only reads with it.", "Paste it on Projects > the Clerk instance > Connect key."],
  },
  revenuecat: {
    reads: "The project's name and apps, and the overview metrics in US dollars: active subscriptions and trials, monthly recurring revenue, and the revenue, new customers and active users of the last 28 days. The revenue counts against the free plan's monthly tracked revenue in the checked limits list.",
    alerts: "Revenue near the free plan's cap, a key that stopped working.",
    keySteps: ["app.revenuecat.com > the project > Project settings > API keys > New: version V2, read permission on projects (project_configuration:projects:read), apps (project_configuration:apps:read) and overview metrics (charts_metrics:overview:read), nothing else.", "Paste it on Projects > the RevenueCat project > Connect key."],
  },
  apple: {
    reads: "The app's name and bundle id, the version live on the App Store, the version in progress and where it stands with App Review, any rejected version, and the newest build and whether it processed. Sales and the membership's renewal date are not read.",
    alerts: "A version App Review rejected, a build that did not process, a key that stopped working.",
    keySteps: ["appstoreconnect.apple.com > Users and Access > Integrations > App Store Connect API > Team keys > Generate: role Developer (App Manager also works), with access to the app. Download the .p8 file once and note the Key ID and the Issuer ID.", "Projects > the App Store Connect app > Connect key: enter the Key ID and the Issuer ID, then paste the text of the .p8 file."],
  },
  github: {
    reads: "The repository's visibility, default branch, last push and open issues, the newest workflow run on the default branch, the open Dependabot, secret scanning and code scanning alerts by severity, and the account's usage this month: Actions minutes against the plan and the bill so far.",
    alerts: "A failed workflow run on the default branch, an open secret scanning alert, an open Dependabot or code scanning alert of critical or high severity, Actions minutes near the plan's limit.",
    keySteps: ["github.com > Settings > Developer settings > Personal access tokens > Fine-grained tokens > Generate: only this repository. Repository permissions, read: Metadata, Actions, Dependabot alerts, Secret scanning alerts, Code scanning alerts. Account permissions, read: Plan.", "Paste it on Projects > the GitHub repository > Connect key."],
  },
  stripe: {
    reads: "The available balance, this month's charges net of refunds before Stripe's fees, and the webhook endpoints registered at Stripe, checked against the webhook routes in the code.",
    alerts: "A Stripe webhook route in the code that no enabled endpoint at Stripe points at, an enabled endpoint pointing at the app with no route behind it.",
    keySteps: ["dashboard.stripe.com/apikeys > Create restricted key: read access to Balance, Charges and Webhook Endpoints, nothing else.", "Paste it on Projects > the Stripe account > Connect key."],
  },
  anthropic: {
    reads: "This month's cost and token usage, from the usage and cost reports.",
    alerts: "Usage near a limit you set on the plan.",
    keySteps: ["platform.claude.com/settings/admin-keys > Create Admin API key. It needs an organization, and birdsI calls only the usage and cost reports.", "Paste it on Projects > the organization > Connect key."],
  },
  resend: {
    reads: "The monthly and daily sending quota and the domains.",
    alerts: "Sending near the quota.",
    keySteps: ["resend.com/api-keys > Create API key with full access: Resend returns the quota only to such a key.", "Paste it on Projects > the domain or account > Connect key."],
  },
  tavily: {
    reads: "The credits left.",
    alerts: "Credits near the end.",
    keySteps: ["app.tavily.com > the same API key the app uses.", "Paste it on Projects > the account > Connect key."],
  },
  supadata: {
    reads: "The plan and the credits left.",
    alerts: "Credits near the end.",
    keySteps: ["dash.supadata.ai > the same API key the app uses.", "Paste it on Projects > the account > Connect key."],
  },
};

export interface ChecklistInput {
  appName: string;
  /** False until the apps migration has run on birdsI's database. */
  appReady: boolean;
  projects: AppProject[];
  untiedKeys: UntiedKey[];
  map: StoredMap | null;
  /** The newest finished map's scope statement, for the model's part. */
  scope: ScanScope | null;
  email: AlertEmailState;
  /** Dates to watch the owner has added. */
  deadlines: number;
  /** What the owner entered by hand, when the table exists. */
  entries?: number;
}

function kindWords(vendor: string): string {
  const spec = PROJECT_VENDOR_BY_SLUG.get(vendor);
  return spec ? spec.kinds.map((k) => k.refLabel.toLowerCase()).join(" or ") : "project";
}

export function checklistView(input: ChecklistInput): ChecklistView {
  const items: ChecklistItem[] = [];
  const map = input.map?.map ?? null;

  // The map, from the terminal.
  items.push({
    id: "map",
    group: "The map",
    title: "Map the code",
    status: map ? "done" : "todo",
    required: true,
    state: map ? `Mapped ${input.map!.createdAt.slice(0, 10)}${map.commit ? ` at ${map.commit.slice(0, 7)}` : ""}: ${map.services.length} services, ${map.env.length} env names, ${map.crons.length} crons, ${map.webhooks.length} webhooks.` : "No map yet.",
    steps: map ? [] : ["In the app's folder: npx birdsi login, then npx birdsi. The map takes about a minute and opens this app's page."],
    willDo: "The map: every service the app uses, the env names each deployment needs, the crons, the webhooks, the store apps, the migrations and the public pages, each with its file and line. Every later read is compared with it.",
    links: [],
    where: null,
  });

  // The model's reading of the code.
  const readerWhy = input.scope?.notChecked.find((n) => n.id === "reader")?.why ?? null;
  items.push({
    id: "reader",
    group: "The map",
    title: "Let the model read the code",
    status: map?.reader ? "done" : "todo",
    required: false,
    state: map?.reader ? `${map.reader.model} read ${map.reader.filesRead} files and confirmed ${map.reader.confirmed + map.reader.carried} finds at their lines.` : (readerWhy ?? "No model has read the code yet."),
    steps: map?.reader ? [] : ["On the birdsI deployment, set NEBIUS_API_KEY (Nemotron on Nebius Token Factory) or ANTHROPIC_API_KEY (Claude), and TAVILY_API_KEY for the docs check. Then map again."],
    willDo: "The model names what the rules missed, each find confirmed at its file and line before it joins the map, writes what the app uses each service for, and the docs check compares each main package with its own current documentation.",
    links: [],
    where: null,
  });

  // The app record.
  items.push({
    id: "app",
    group: "The app",
    title: "The app and its environments",
    status: input.appReady ? "done" : "blocked",
    required: true,
    state: input.appReady ? `${input.appName}, ${input.projects.length} ${input.projects.length === 1 ? "project" : "projects"} declared.` : "Waiting on the migration 20261018000100_apps_projects.sql on birdsI's database.",
    steps: input.appReady ? [] : ["Run the migration in the Supabase SQL editor of birdsI's own project, then open this page again."],
    willDo: "A name, the environments it runs in, and the vendor projects it has, one per place the app lives at a vendor.",
    links: [],
    where: "/projects",
  });

  // Keys from before keys belonged to projects.
  if (input.untiedKeys.length > 0) {
    items.push({
      id: "untied",
      group: "The app",
      title: "Tie the older keys to their projects",
      status: "todo",
      required: true,
      state: `${input.untiedKeys.length} ${input.untiedKeys.length === 1 ? "key" : "keys"} connected before keys belonged to a project: ${input.untiedKeys.map((k) => k.vendorName).join(", ")}. Still read the old way until tied.`,
      steps: ["On Projects, under Keys not tied to a project yet, pick the project each key reads."],
      willDo: "Each key reads exactly one project, so the cockpit can tell projects of the same vendor apart.",
      links: [],
      where: "/projects",
    });
  }

  // Per service the map found, and per vendor a project was declared for.
  const vendors = new Map<string, { name: string; dashboardUrl: string | null; pricingUrl: string | null }>();
  for (const s of map?.services ?? []) vendors.set(s.slug, { name: s.name, dashboardUrl: s.dashboardUrl, pricingUrl: s.pricingUrl });
  for (const p of input.projects) if (!vendors.has(p.vendor)) vendors.set(p.vendor, { name: PROJECT_VENDOR_BY_SLUG.get(p.vendor)?.name ?? p.vendor, dashboardUrl: null, pricingUrl: null });
  const unreadable: string[] = [];
  const ordered = [...vendors.entries()].sort((a, b) => {
    const ra = PROJECT_VENDOR_BY_SLUG.get(a[0])?.reads ? 0 : 1;
    const rb = PROJECT_VENDOR_BY_SLUG.get(b[0])?.reads ? 0 : 1;
    return ra - rb || a[1].name.localeCompare(b[1].name);
  });
  for (const [slug, v] of ordered) {
    const spec = PROJECT_VENDOR_BY_SLUG.get(slug);
    const projects = input.projects.filter((p) => p.vendor === slug);
    const links = [...(v.dashboardUrl ? [{ label: `${v.name} dashboard`, url: v.dashboardUrl }] : []), ...(v.pricingUrl ? [{ label: "Pricing", url: v.pricingUrl }] : [])];
    if (!spec) {
      unreadable.push(v.name);
      continue;
    }
    if (!spec.reads) {
      items.push({
        id: `${slug}-project`,
        group: v.name,
        title: `Declare the ${v.name} ${kindWords(slug)}`,
        status: projects.length > 0 ? "done" : "optional",
        required: false,
        state: projects.length > 0 ? `${projects.length} declared.` : `birdsI cannot read ${v.name} yet, so this only puts its dashboard link on the cockpit.`,
        steps: projects.length > 0 ? [] : spec.kinds.map((k) => `Projects > Add a project > ${v.name}: ${k.refLabel}. ${k.refHint}`),
        willDo: `A link into ${v.name}'s dashboard on the cockpit. What ${v.name} knows (plans, counts, money) goes in the manual entries until birdsI can read it.`,
        links,
        where: "/projects",
      });
      continue;
    }
    const ability = VENDOR_ABILITIES[slug];
    const deep = spec.kinds.some((k) => readsInDepth(slug, k.kind));
    items.push({
      id: `${slug}-project`,
      group: v.name,
      title: `Declare the ${v.name} ${kindWords(slug)}`,
      status: projects.length > 0 ? "done" : "todo",
      required: true,
      state: projects.length > 0 ? `${projects.length} declared: ${projects.map((p) => p.label ?? p.ref).join(", ")}.` : `Not declared. ${deep ? "The cockpit reads it in depth once it has a key." : "Its account facts show on the Vendors page once it has a key."}`,
      steps: projects.length > 0 ? [] : spec.kinds.map((k) => `Projects > Add a project > ${v.name}: ${k.refLabel}. ${k.refHint}`),
      willDo: ability ? `${ability.reads} Alerts: ${ability.alerts}` : null,
      links,
      where: "/projects",
    });
    const keyed = projects.filter((p) => p.key);
    const failed = keyed.filter((p) => p.key!.lastStatus === "failed");
    const missing = projects.filter((p) => !p.key);
    const keyStatus: ChecklistStatus = projects.length === 0 ? "todo" : failed.length > 0 ? "failed" : missing.length > 0 ? "todo" : "done";
    items.push({
      id: `${slug}-key`,
      group: v.name,
      title: `Connect a read key for each ${v.name} ${kindWords(slug)}`,
      status: keyStatus,
      required: true,
      state:
        projects.length === 0
          ? "Declare the project first."
          : failed.length > 0
            ? `${failed.length === 1 ? "A key" : `${failed.length} keys`} stopped working: ${failed.map((p) => `${p.label ?? p.ref} (${p.key!.lastError ?? "no detail"})`).join(", ")}.`
            : missing.length > 0
              ? `${missing.length} of ${projects.length} without a key: ${missing.map((p) => p.label ?? p.ref).join(", ")}.`
              : `${keyed.length} ${keyed.length === 1 ? "key" : "keys"} connected${keyed.every((p) => p.key!.lastReadAt) ? ", reading" : ", read within the hour"}.`,
      steps: keyStatus === "done" ? [] : [...(ability?.keySteps ?? [spec.keyHint, "Paste it on Projects > the project > Connect key."])],
      willDo: ability ? `${ability.reads} Alerts: ${ability.alerts}` : null,
      links: spec.keyUrl ? [{ label: `Make the key at ${spec.keyUrl.replace(/^https?:\/\//, "")}`, url: spec.keyUrl }, ...links] : links,
      where: "/projects",
    });
  }
  if (unreadable.length > 0) {
    items.push({
      id: "unreadable",
      group: "Services birdsI cannot read yet",
      title: `${unreadable.length === 1 ? "One service" : `${unreadable.length} services`} with links only`,
      status: "optional",
      required: false,
      state: `${unreadable.join(", ")}: birdsI has no reader for ${unreadable.length === 1 ? "it" : "them"} yet. Dashboard and pricing links are on the cockpit, and what you know about ${unreadable.length === 1 ? "it" : "them"} goes in the manual entries.`,
      steps: [],
      willDo: null,
      links: [],
      where: null,
    });
  }

  // Alerts by email, and the dates no API reports.
  items.push({
    id: "email",
    group: "Alerts",
    title: "Get new alerts by email",
    status: input.email.on ? "done" : "todo",
    required: false,
    state: input.email.sentence,
    steps: input.email.on ? [] : ["On the birdsI deployment: RESEND_API_KEY from resend.com > API Keys, with sending access. Resend's shared sender delivers only to the Resend account's own address.", "In Settings: turn email alerts on."],
    willDo: "One email per app per read, listing the alerts it opened, critical and warning only.",
    links: [],
    where: "/settings",
  });
  items.push({
    id: "dates",
    group: "Alerts",
    title: "Add the dates no API reports",
    status: input.deadlines > 0 ? "done" : "optional",
    required: false,
    state: input.deadlines > 0 ? `${input.deadlines} ${input.deadlines === 1 ? "date" : "dates"} to watch.` : "A trial that ends, a credit that runs out: nothing added yet.",
    steps: input.deadlines > 0 ? [] : ["Projects > Dates to watch > add the vendor, the date and what ends."],
    willDo: "An alert from 30 days before the date, critical from 7 days before, until two weeks after.",
    links: [],
    where: "/projects",
  });
  if (input.entries !== undefined) {
    items.push({
      id: "entries",
      group: "Money",
      title: "Add what no API reports",
      status: input.entries > 0 ? "done" : "optional",
      required: false,
      state: input.entries > 0 ? `${input.entries} ${input.entries === 1 ? "entry" : "entries"} by hand.` : "A subscription paid elsewhere, a yearly fee, a credit that runs out: nothing entered yet.",
      steps: input.entries > 0 ? [] : ["Projects > What no API reports > add the kind, the amount and how often, and the renewal date if there is one."],
      willDo: "Counted in the money section as entered by you, kept apart from what is read, and a renewal date warns from 30 days before like a date to watch.",
      links: [],
      where: "/projects",
    });
  }
  items.push({
    id: "agent",
    group: "Your coding agent",
    title: "Give your coding agent the cockpit",
    status: "optional",
    required: false,
    state: "Agents read everything here through the MCP server and the terminal tool, and can ask you questions and propose commands you approve.",
    steps: ["npx birdsi mcp --install-hint prints the MCP configuration for Claude Code, Cursor and Codex.", "npx birdsi policy --hint prints the hook that stops account-changing commands and routes them to approvals."],
    willDo: null,
    links: [],
    where: "/agent",
  });

  const required = items.filter((i) => i.required);
  const optional = items.filter((i) => !i.required);
  const doneCount = (list: ChecklistItem[]) => list.filter((i) => i.status === "done").length;
  return {
    appName: input.appName,
    items,
    required: { done: doneCount(required), total: required.length },
    optional: { done: doneCount(optional), total: optional.length },
    complete: required.every((i) => i.status === "done"),
    mayDo: MAY_DO,
  };
}
