import { z } from "zod";
import { FindKind, VendorCategory, type PromptSection, type ServiceMap } from "@birdsi/shared";
import { DOCS_SYSTEM } from "../checks/docs";
import { toJsonSchema } from "../models/schema";

/** One thing the model says the rules missed, with the line that proves it. */
export const Find = z.object({
  kind: FindKind,
  name: z.string().max(120).describe("The service's name, the env name, the cron's route or job name, the webhook's route, the app's bundle id, or a short label"),
  detail: z.string().max(240).describe("What the app uses it for, or what the schedule, route or config does, in one plain sentence"),
  category: VendorCategory.nullable().describe("For a service: its kind. Null for anything else"),
  schedule: z.string().max(60).nullable().describe("For a cron: the schedule exactly as written, cron syntax when it is cron syntax. Null for anything else"),
  path: z.string().describe("The file, exactly as its heading shows it"),
  line: z.number().int().positive().describe("The line number shown at the start of the line"),
  quote: z.string().max(200).describe("That line's text, copied exactly, with any double quote mark written as a single quote mark"),
});
export type Find = z.infer<typeof Find>;

export const Finds = z.object({ finds: z.array(Find).max(60) });
export type Finds = z.infer<typeof Finds>;
export const FINDS_JSON_SCHEMA = toJsonSchema(Finds);

export const Purposes = z.object({
  purposes: z.array(z.object({ slug: z.string(), purpose: z.string().max(200).nullable().describe("One plain sentence saying what this app uses the service for, or null when the lines do not say") })).max(80),
});
export type Purposes = z.infer<typeof Purposes>;
export const PURPOSES_JSON_SCHEMA = toJsonSchema(Purposes);

export const READER_SYSTEM = `You are birdsI's second reader of an app's code. Rules already read the code and built the map you are given: the services the app uses, the env names it reads, its crons, webhooks, store apps and migrations. Your job is only what the rules missed.

Report an entry only when the code you are shown proves it and the map does not already have it:
- service: an outside service, SDK, API or hosted product the app depends on (a database, auth, payments, email, push, analytics, an AI API, storage, maps, monitoring, hosting). Not a code library with no account behind it.
- env: an environment variable the code reads that the map lacks, including a name read through a helper or a computed key.
- cron: a scheduled job the map lacks: a GitHub Actions schedule, pg_cron, node-cron, a Vercel cron in a nested vercel.json, a timer loop.
- webhook: a route or handler that receives another system's callbacks.
- store_app: an iOS, Android, Expo or Capacitor app config the map lacks.
- migration: a database migration source the map lacks (Prisma, Drizzle, Knex, a SQL folder).
- deployment: a second deployable the map lacks: a Dockerfile, fly.toml, a Railway or Render config, a second app in the repository.
- other: anything else that makes the app run and the map lacks.

For every entry give the file exactly as its heading shows it, the line number shown at the start of the line, and that line's text copied exactly, with any double quote mark written as a single quote mark. An entry whose line does not say what you claim is dropped. Prefer the line that names the thing: the import, the env read, the schedule, the route. When nothing is missing, return an empty list. Never report what the map already has, and never guess from a file name alone.`;

export const PURPOSES_SYSTEM = `You write one plain sentence per service saying what this app uses it for, from the lines of code shown and nothing else. Name the feature or the job in the app's own terms, for example: sends the daily digest emails, or stores uploaded photos. When the lines do not say what it is for, answer null for that service. Keep every sentence under twenty words. Do not use emojis, em dashes, semicolons or exclamation marks.`;

export const SECURITY_SYSTEM = `The security pass: for every route and server action, the model quotes the line that checks who the caller is, with the whole file in view, and the verifier confirms the quote. A route with no confirmable check is shown only after a second pass, asked to prove the opposite, fails. Not on in this version: it is measured against labelled findings first.`;

/** The default prompt of each section, shown beside the owner's addition. */
export const DEFAULT_PROMPTS: Record<PromptSection, string> = { reader: READER_SYSTEM, purposes: PURPOSES_SYSTEM, docs: DOCS_SYSTEM, security: SECURITY_SYSTEM };

/** The system prompt with the owner's addition for this app, when there is one. */
export function withOwner(system: string, addition: string | undefined): string {
  const text = addition?.trim();
  return text ? `${system}\n\nThe owner adds, for this app: ${text}` : system;
}

/** The map so far, in a few lines, as the stable prefix of every reading call. */
export function mapSummary(map: ServiceMap): string {
  const services = map.services.map((s) => `${s.slug} (${s.name}${s.packages.length > 0 ? `, packages ${s.packages.slice(0, 3).join(", ")}` : ""}${s.envNames.length > 0 ? `, env ${s.envNames.slice(0, 3).join(", ")}` : ""})`);
  const crons = map.crons.map((c) => `${c.path} (${c.schedule}, ${c.kind})`);
  const lines = [
    "The map so far.",
    `Services (${map.services.length}): ${services.join(" | ") || "none"}`,
    `Env names (${map.env.length}): ${map.env.map((e) => e.name).join(", ") || "none"}`,
    `Crons (${map.crons.length}): ${crons.join(" | ") || "none"}`,
    `Webhooks (${map.webhooks.length}): ${map.webhooks.map((w) => `${w.route} (${w.file})`).join(" | ") || "none"}`,
    `Store apps (${map.storeApps.length}): ${map.storeApps.map((a) => `${a.bundleId ?? "no id"} (${a.platform})`).join(" | ") || "none"}`,
    `Migrations: ${map.migrations.style ? `${map.migrations.style} in ${map.migrations.dir} (${map.migrations.files.length} files)` : "none found"}`,
    `Deployment roles: ${map.roles.names.length > 0 ? `${map.roles.names.join(", ")} (${map.roles.envName})` : "one deployment"}`,
    `Units: ${map.units.map((u) => `${u.path || "."} (${u.framework ?? "no framework"})`).join(" | ")}`,
  ];
  return lines.join("\n");
}
