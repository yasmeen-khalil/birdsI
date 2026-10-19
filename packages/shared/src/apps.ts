import { z } from "zod";

/**
 * An app is the owner's own record: a name, the repository its code lives
 * in, the environments it runs in, and the vendor projects it has. A key is
 * tied to one of those projects and only reads. Nothing here ever holds a key.
 */

export const ProjectKind = z.enum(["project", "team", "organization", "instance", "app", "account", "domain"]);
export type ProjectKind = z.infer<typeof ProjectKind>;

export const Environment = z.enum(["production", "preview", "development"]);
export type Environment = z.infer<typeof Environment>;

/** A key as the owner and agents may see it: its label and state, never the key. */
export const ProjectKey = z.object({
  id: z.string(),
  label: z.string().nullable(),
  /** Read only in this phase, enforced by the database. */
  scope: z.literal("read"),
  /** A short keyed hash: the same for two projects that share one key, and useless for anything else. */
  fingerprint: z.string().nullable(),
  /** Labels of the app's other projects read with the same key. */
  sharedWith: z.array(z.string()),
  lastReadAt: z.string().nullable(),
  lastStatus: z.enum(["ok", "failed"]).nullable(),
  lastError: z.string().nullable(),
  createdAt: z.string(),
});
export type ProjectKey = z.infer<typeof ProjectKey>;

export const AppProject = z.object({
  id: z.string(),
  appId: z.string(),
  vendor: z.string(),
  kind: ProjectKind,
  ref: z.string(),
  label: z.string().nullable(),
  environment: Environment.nullable(),
  plan: z.string().nullable(),
  settings: z.record(z.string(), z.string()),
  /** Where this project lives in the vendor's own dashboard. */
  dashboardUrl: z.string(),
  key: ProjectKey.nullable(),
  createdAt: z.string(),
});
export type AppProject = z.infer<typeof AppProject>;

export const App = z.object({
  id: z.string(),
  repoId: z.string(),
  name: z.string(),
  environments: z.array(Environment),
  projects: z.array(AppProject),
  createdAt: z.string(),
});
export type App = z.infer<typeof App>;

/** A key connected before keys were tied to projects: still read the old way until the owner ties it. */
export const UntiedKey = z.object({
  id: z.string(),
  vendor: z.string(),
  vendorName: z.string(),
  /** Non-secret identifiers it was connected with, such as a team id or a project ref. */
  settings: z.record(z.string(), z.string()),
  lastStatus: z.enum(["ok", "failed"]).nullable(),
  lastError: z.string().nullable(),
  createdAt: z.string(),
});
export type UntiedKey = z.infer<typeof UntiedKey>;

export const AppResponse = z.object({ app: App.nullable(), untiedKeys: z.array(UntiedKey) });
export type AppResponse = z.infer<typeof AppResponse>;

export interface ProjectKindSpec {
  kind: ProjectKind;
  /** What the owner types: "Project ref", "App id". */
  refLabel: string;
  /** Where to find it, in one line. */
  refHint: string;
  /** A shape the ref must have, when the vendor's ids have one. */
  refPattern: RegExp | null;
}

export interface ProjectVendor {
  vendor: string;
  name: string;
  kinds: ProjectKindSpec[];
  /** Identifiers besides the ref that reading needs, never secrets. */
  settings: Array<{ key: string; label: string; hint: string; required: boolean }>;
  /** True when birdsI can read this vendor with a key in this phase. */
  reads: boolean;
  /** How to make the key, in one line, and where. Empty when there is no reader yet. */
  keyHint: string;
  keyUrl: string | null;
  dashboard: (project: { kind: ProjectKind; ref: string; settings: Record<string, string> }) => string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** The vendors an app's projects are declared for, with the shape of each one's ids and where they live. */
export const PROJECT_VENDORS: readonly ProjectVendor[] = [
  {
    vendor: "vercel",
    name: "Vercel",
    kinds: [
      { kind: "project", refLabel: "Project name or id", refHint: "Vercel > the project > Settings > General: Project Name, or Project ID (prj_...).", refPattern: /^(prj_[A-Za-z0-9]+|[a-z0-9][a-z0-9._-]{0,99})$/ },
      { kind: "team", refLabel: "Team id", refHint: "Vercel > Team Settings > General > Team ID (team_...).", refPattern: /^team_[A-Za-z0-9]+$/ },
    ],
    settings: [
      { key: "team", label: "Team id or slug", hint: "The team the project belongs to: team_... from Team Settings, or the slug in its address. Leave empty for a personal account.", required: false },
    ],
    reads: true,
    keyHint: "An access token scoped to the team, with an expiry. Vercel offers no token that only reads, so birdsI only reads with it.",
    keyUrl: "https://vercel.com/account/settings/tokens",
    dashboard: (p) => {
      const team = p.settings["team"] ?? "";
      if (p.kind === "project" && team && !team.startsWith("team_")) return `https://vercel.com/${encodeURIComponent(team)}/${encodeURIComponent(p.ref)}`;
      return "https://vercel.com/dashboard";
    },
  },
  {
    vendor: "supabase",
    name: "Supabase",
    kinds: [
      { kind: "project", refLabel: "Project ref", refHint: "The 20 letters in the project's address: supabase.com/dashboard/project/<ref>.", refPattern: /^[a-z]{20}$/ },
      { kind: "organization", refLabel: "Organization slug", refHint: "From the organization's address: supabase.com/dashboard/org/<slug>.", refPattern: NAME },
    ],
    settings: [],
    reads: true,
    keyHint: "A scoped personal access token with Read access only (Projects, Project Settings, Organization Settings, Advisors, Migrations, Database).",
    keyUrl: "https://supabase.com/dashboard/account/tokens",
    dashboard: (p) => (p.kind === "project" ? `https://supabase.com/dashboard/project/${encodeURIComponent(p.ref)}` : `https://supabase.com/dashboard/org/${encodeURIComponent(p.ref)}`),
  },
  {
    vendor: "onesignal",
    name: "OneSignal",
    kinds: [{ kind: "app", refLabel: "App id", refHint: "OneSignal > the app > Settings > Keys & IDs > OneSignal App ID.", refPattern: UUID }],
    settings: [],
    reads: true,
    keyHint: "An App API key for this app (Settings > Keys & IDs). OneSignal keys cannot be made read only, so birdsI only reads with it.",
    keyUrl: "https://dashboard.onesignal.com",
    dashboard: (p) => `https://dashboard.onesignal.com/apps/${encodeURIComponent(p.ref)}`,
  },
  {
    vendor: "clerk",
    name: "Clerk",
    kinds: [{ kind: "instance", refLabel: "Instance id", refHint: "Clerk > the application > Configure > the instance id (ins_...).", refPattern: /^ins_[A-Za-z0-9]+$/ }],
    settings: [{ key: "application", label: "Application id", hint: "app_... from the application's address in the Clerk dashboard.", required: false }],
    reads: false,
    keyHint: "",
    keyUrl: null,
    dashboard: (p) => (p.settings["application"] ? `https://dashboard.clerk.com/apps/${encodeURIComponent(p.settings["application"])}/instances/${encodeURIComponent(p.ref)}` : "https://dashboard.clerk.com"),
  },
  {
    vendor: "revenuecat",
    name: "RevenueCat",
    kinds: [{ kind: "project", refLabel: "Project id", refHint: "The id in the project's address on app.revenuecat.com.", refPattern: NAME }],
    settings: [],
    reads: false,
    keyHint: "",
    keyUrl: null,
    dashboard: (p) => `https://app.revenuecat.com/projects/${encodeURIComponent(p.ref)}`,
  },
  {
    vendor: "stripe",
    name: "Stripe",
    kinds: [{ kind: "account", refLabel: "Account id", refHint: "Stripe > Settings > Business > Account details: acct_...", refPattern: /^acct_[A-Za-z0-9]+$/ }],
    settings: [],
    reads: true,
    keyHint: "A restricted key with read access to Balance and Charges.",
    keyUrl: "https://dashboard.stripe.com/apikeys",
    dashboard: () => "https://dashboard.stripe.com",
  },
  {
    vendor: "apple",
    name: "App Store Connect",
    kinds: [{ kind: "app", refLabel: "Apple ID of the app", refHint: "App Store Connect > the app > App Information > Apple ID (digits).", refPattern: /^\d{6,12}$/ }],
    settings: [{ key: "bundleId", label: "Bundle id", hint: "The bundle id, for example com.example.app.", required: false }],
    reads: false,
    keyHint: "",
    keyUrl: null,
    dashboard: (p) => `https://appstoreconnect.apple.com/apps/${encodeURIComponent(p.ref)}/distribution`,
  },
  {
    vendor: "resend",
    name: "Resend",
    kinds: [
      { kind: "domain", refLabel: "Sending domain", refHint: "The domain the app sends from, as listed on resend.com/domains.", refPattern: /^[a-z0-9.-]+\.[a-z]{2,}$/ },
      { kind: "account", refLabel: "Account name", refHint: "Any name for the Resend account.", refPattern: NAME },
    ],
    settings: [],
    reads: true,
    keyHint: "An API key with full access: Resend returns the sending quota only to such a key. Resend offers no key that only reads.",
    keyUrl: "https://resend.com/api-keys",
    dashboard: () => "https://resend.com/domains",
  },
  {
    vendor: "anthropic",
    name: "Anthropic (Claude)",
    kinds: [{ kind: "organization", refLabel: "Organization name", refHint: "Any name for the organization whose usage the key reads.", refPattern: NAME }],
    settings: [],
    reads: true,
    keyHint: "An Admin API key (sk-ant-admin...). It needs an organization, and also manages it: birdsI calls only the usage and cost reports.",
    keyUrl: "https://platform.claude.com/settings/admin-keys",
    dashboard: () => "https://platform.claude.com/usage",
  },
  {
    vendor: "tavily",
    name: "Tavily",
    kinds: [{ kind: "account", refLabel: "Account name", refHint: "Any name for the account.", refPattern: NAME }],
    settings: [],
    reads: true,
    keyHint: "The same API key the app uses.",
    keyUrl: "https://app.tavily.com/home",
    dashboard: () => "https://app.tavily.com",
  },
  {
    vendor: "supadata",
    name: "Supadata",
    kinds: [{ kind: "account", refLabel: "Account name", refHint: "Any name for the account.", refPattern: NAME }],
    settings: [],
    reads: true,
    keyHint: "The same API key the app uses.",
    keyUrl: "https://dash.supadata.ai",
    dashboard: () => "https://dash.supadata.ai",
  },
];

export const PROJECT_VENDOR_BY_SLUG = new Map(PROJECT_VENDORS.map((v) => [v.vendor, v]));

/** Checks a project before it is stored; returns the problem in plain words, or null. */
export function projectProblem(input: { vendor: string; kind: string; ref: string; settings: Record<string, string> }): string | null {
  const vendor = PROJECT_VENDOR_BY_SLUG.get(input.vendor);
  if (!vendor) return "birdsI does not know that vendor's projects yet.";
  const spec = vendor.kinds.find((k) => k.kind === input.kind);
  if (!spec) return `${vendor.name} has no ${input.kind} here. Choose ${vendor.kinds.map((k) => k.refLabel.toLowerCase()).join(" or ")}.`;
  const ref = input.ref.trim();
  if (!ref) return `${spec.refLabel} is needed.`;
  if (ref.length > 200) return `${spec.refLabel} is too long.`;
  if (spec.refPattern && !spec.refPattern.test(ref)) return `That does not look like a ${vendor.name} ${spec.refLabel.toLowerCase()}. ${spec.refHint}`;
  for (const s of vendor.settings) if (s.required && !(input.settings[s.key] ?? "").trim()) return `${s.label} is needed.`;
  return null;
}

/** The address of a project in the vendor's own dashboard. */
export function projectDashboardUrl(project: { vendor: string; kind: ProjectKind; ref: string; settings: Record<string, string> }): string {
  return PROJECT_VENDOR_BY_SLUG.get(project.vendor)?.dashboard(project) ?? "";
}
