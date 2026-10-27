import { findingKey, type FindingDraft, type ServiceMap } from "@birdsi/shared";
import { reach } from "../map/graph";
import { CATALOG_BY_SLUG } from "../vendors/catalog";
import type { Check, CheckContext } from "./types";

/**
 * The map checked against itself. Every rule here is Proven: it compares
 * two things the map read with their file and line, and says which is
 * missing. A cron with no handler or no secret check, a webhook with no
 * sender check, an SDK with no key, an env name declared but never read, a
 * package listed but never imported, files no route reaches, two services
 * for one job.
 */

export interface GapInput {
  map: ServiceMap;
  /** Runtime packages per manifest (the dependencies section, never devDependencies). */
  runtimeDependencies: Array<{ name: string; manifestPath: string }>;
  /** Packages imported anywhere in the code. */
  importedPackages: ReadonlySet<string>;
  /** Code files under the app's source folders that no page, route or entry reaches. */
  unreached: string[];
  /** Whether the app has entries at all (a Next.js app does), so an unreached file means something. */
  hasEntries: boolean;
}

/** Packages that do their work from the command line, a config file or the framework, never through an import. */
const TOOLING = /^(@types\/|eslint|prettier|typescript$|vitest|jest|@vitest|tsx$|ts-node|esbuild|tailwindcss|postcss|autoprefixer|@tailwindcss|turbo$|husky|lint-staged|@playwright|playwright|cypress|storybook|@storybook|@next\/|next$|sharp$|@vercel\/|vercel$|supabase$|wrangler|nodemon|concurrently|dotenv|cross-env|rimraf|npm-run-all|@biomejs|biome|knip|@eslint|globals$|@typescript-eslint|eslint-|react-dom$|react$|@capacitor\/(cli|core|ios|android)|@expo\/|expo$|expo-)/;

/** Categories where two services usually means one is a leftover. */
const ONE_JOB: Record<string, string> = { email: "email", payments: "payments", auth: "sign-in", analytics: "analytics", monitoring: "error tracking" };

const MAX_LISTED = 25;

function listed(items: string[]): string {
  const shown = items.slice(0, MAX_LISTED);
  return items.length > MAX_LISTED ? `${shown.join(", ")} and ${items.length - MAX_LISTED} more` : shown.join(", ");
}

function key(path: string | null, subject: string): string {
  return findingKey({ checkId: "gaps", path, subject });
}

export function findGaps(input: GapInput): FindingDraft[] {
  const { map } = input;
  const out: FindingDraft[] = [];

  // A Vercel cron with no handler file in the code.
  for (const cron of map.crons.filter((c) => c.kind === "vercel" && c.handler === null)) {
    out.push({
      key: key(cron.source.path, `cron-no-handler:${cron.path}`),
      checkId: "gaps",
      title: `The cron ${cron.path} has no handler in the code`,
      explanation: `${cron.source.path} schedules ${cron.path} (${cron.every}), but no route file answers that address. Vercel will call it on schedule and get a 404.`,
      whyItMatters: "A scheduled job that does not exist runs nothing, silently, and the work it was meant to do (a digest, a cleanup) never happens.",
      severity: "medium",
      confidence: "proven",
      category: "gap",
      location: { path: cron.source.path, lineStart: cron.source.line },
      evidence: { advisories: [], excerpt: cron.source.text, rule: "A cron in vercel.json whose path matches no route file in the app" },
      actionKind: "fix",
      steps: [],
      fixPlan: { summary: `Add a route handler at ${cron.path}, or remove the cron from ${cron.source.path}.`, paths: [cron.source.path], followUp: [] },
    });
  }

  // A Vercel cron whose handler does not check the secret Vercel sends.
  for (const cron of map.crons.filter((c) => c.kind === "vercel" && c.handler !== null && !c.checksSecret)) {
    out.push({
      key: key(cron.handler, "cron-no-secret"),
      checkId: "gaps",
      title: `The cron handler ${cron.handler} does not check CRON_SECRET`,
      explanation: `${cron.path} runs ${cron.every} from ${cron.source.path}. Its handler, ${cron.handler}, and the files it imports never read CRON_SECRET, so anyone who knows the address can run the job as often as they like.`,
      whyItMatters: "A cron that anyone can trigger can be run thousands of times: a cleanup that deletes, a digest that emails, a sync that bills.",
      severity: "high",
      confidence: "proven",
      category: "security",
      location: { path: cron.handler! },
      evidence: { advisories: [], rule: "No read of CRON_SECRET in the handler or any file it imports" },
      actionKind: "fix",
      steps: [],
      fixPlan: { summary: `In ${cron.handler}, compare the Authorization header with Bearer and the CRON_SECRET value before doing anything, and answer 401 otherwise. Set CRON_SECRET on the Vercel project.`, paths: [cron.handler!], followUp: ["Set CRON_SECRET in the Vercel project's environment variables. Vercel sends it as a bearer token with every cron call."] },
    });
  }

  // A webhook route with no line that checks the sender.
  for (const hook of map.webhooks.filter((w) => w.verifies === null)) {
    out.push({
      key: key(hook.file, "webhook-unverified"),
      checkId: "gaps",
      title: `The webhook ${hook.route} does not check who sent the request`,
      explanation: `${hook.file} receives ${hook.service ? `${hook.service}'s` : "a vendor's"} events at ${hook.route}, and no line in it checks a signature or a shared secret. Anything that posts to that address is treated as a real event.`,
      whyItMatters: "A forged event can mark an order paid, a subscription active or a user verified. Vendors sign their webhooks so the app can tell.",
      severity: "high",
      confidence: "proven",
      category: "security",
      location: { path: hook.file },
      evidence: { advisories: [], rule: "No signature check (constructEvent, verify, timingSafeEqual, createHmac) and no signature header read in the route file" },
      actionKind: "fix",
      steps: [],
      fixPlan: { summary: `Verify the signature in ${hook.file} with the vendor's SDK before reading the event, and reject the request when it fails.`, paths: [hook.file], followUp: ["Set the webhook signing secret from the vendor's dashboard in the project's environment variables."] },
    });
  }

  // An SDK imported, with no key for it anywhere in the code or the example env file.
  for (const service of map.services) {
    if (!service.how.some((h) => h === "package" || h === "import")) continue;
    const entry = CATALOG_BY_SLUG.get(service.slug);
    if (!entry || entry.envVars.length === 0 || entry.category === "hosting") continue;
    const hasKey = map.env.some((e) => entry.envVars.some((re) => re.test(e.name)));
    if (hasKey) continue;
    const at = service.imports[0] ?? service.sources[0] ?? null;
    out.push({
      key: key(at?.path ?? null, `sdk-no-key:${service.slug}`),
      checkId: "gaps",
      title: `The code uses ${service.name} but no ${service.name} key is named anywhere`,
      explanation: `${service.name}'s SDK is ${service.packages.length > 0 ? `installed (${service.packages.join(", ")})` : "imported"}${at ? ` and used at ${at.path}:${at.line}` : ""}, but no env name for it appears in the code or in the example env file. The key must be set some other way, or the SDK runs without one.`,
      whyItMatters: "A key that is not named in the code or the example file is easy to forget on a new deployment, and nothing on the cockpit can tell you it is missing.",
      severity: "medium",
      confidence: "proven",
      category: "gap",
      location: at ? { path: at.path, lineStart: at.line } : null,
      evidence: { advisories: [], ...(at ? { excerpt: at.text } : {}), rule: `No env name matching ${service.name}'s key shapes in the code's env reads or the example env file` },
      actionKind: "fix",
      steps: [],
      fixPlan: { summary: `Name ${service.name}'s key in the example env file, with no value, and read it where the SDK is set up.`, paths: [".env.example"], followUp: [] },
    });
  }

  // An env name declared in the example file that nothing reads, and no SDK could read for the app.
  for (const env of map.env.filter((e) => e.areas.length === 1 && e.areas[0] === "declared" && e.service === null && e.declared !== null)) {
    out.push({
      key: key(env.declared!.path, `env-unread:${env.name}`),
      checkId: "gaps",
      title: `${env.name} is in ${env.declared!.path} but nothing in the code reads it`,
      explanation: `${env.declared!.path} names ${env.name}${env.note ? ` (${env.note})` : ""}, and no file reads it, and it belongs to no SDK the app imports. It is either a leftover or a name read in a way the map cannot follow.`,
      whyItMatters: "A leftover name in the example file sends every new deployment hunting for a value nothing uses.",
      severity: "low",
      confidence: "proven",
      category: "stale",
      location: { path: env.declared!.path, lineStart: env.declared!.line },
      evidence: { advisories: [], rule: "Declared in the example env file, read by no file, matched to no vendor's key shapes" },
      actionKind: "fix",
      steps: [],
      fixPlan: { summary: `Remove ${env.name} from ${env.declared!.path}, or read it where it is meant to be used.`, paths: [env.declared!.path], followUp: [] },
    });
  }

  // Packages listed as dependencies that nothing imports.
  const byManifest = new Map<string, string[]>();
  for (const dep of input.runtimeDependencies) {
    if (TOOLING.test(dep.name) || input.importedPackages.has(dep.name)) continue;
    byManifest.set(dep.manifestPath, [...(byManifest.get(dep.manifestPath) ?? []), dep.name]);
  }
  for (const [manifestPath, names] of byManifest) {
    names.sort();
    out.push({
      key: key(manifestPath, "dependencies-unused"),
      checkId: "gaps",
      title: `${names.length === 1 ? `${names[0]} is` : `${names.length} packages are`} listed in ${manifestPath} but never imported`,
      explanation: `${listed(names)}: in the dependencies of ${manifestPath}, imported by no file. Packages used only from the command line, a config file or the framework are left out of this list.`,
      whyItMatters: "Every package installed is code shipped and watched for vulnerabilities. One nothing uses is weight and noise, and the next vulnerability alert about it is a false alarm.",
      severity: "low",
      confidence: "proven",
      category: "redundancy",
      location: { path: manifestPath },
      evidence: { advisories: [], rule: "In dependencies, not matched by any import or require in the code, not a known tooling package" },
      actionKind: "fix",
      steps: [],
      fixPlan: { summary: `Remove ${names.length === 1 ? names[0] : "the unused packages"} from ${manifestPath} after checking nothing loads ${names.length === 1 ? "it" : "them"} by name at run time.`, paths: [manifestPath], followUp: [] },
    });
  }

  // Code no page, route or entry reaches.
  if (input.hasEntries && input.unreached.length > 0) {
    const files = [...input.unreached].sort();
    out.push({
      key: key(null, "files-unreached"),
      checkId: "gaps",
      title: `${files.length === 1 ? "One file is" : `${files.length} files are`} not reached from any page, route or entry`,
      explanation: `${listed(files)}: under the app's source folders, imported by nothing that a page, a route, a layout, the proxy or the config reaches. Code the app cannot run from any address.`,
      whyItMatters: "Dead code still gets read, searched and updated, and a coding agent may wire it back in by mistake. A file only a script or a test uses can be moved next to them.",
      severity: "low",
      confidence: "proven",
      category: "stale",
      location: { path: files[0]! },
      evidence: { advisories: [], rule: "Not in the set of files reached by following imports from every entry of the app" },
      actionKind: "fix",
      steps: [],
      fixPlan: { summary: "Delete the files nothing uses, or move the ones scripts and tests use out of the app's source folders.", paths: files.slice(0, MAX_LISTED), followUp: [] },
    });
  }

  // Two services for one job.
  const byCategory = new Map<string, string[]>();
  for (const s of map.services) if (ONE_JOB[s.category]) byCategory.set(s.category, [...(byCategory.get(s.category) ?? []), s.name]);
  for (const [category, names] of byCategory) {
    if (names.length < 2) continue;
    const job = ONE_JOB[category]!;
    out.push({
      key: key(null, `two-for-one:${category}`),
      checkId: "gaps",
      title: `${names.length} services for ${job}: ${names.join(" and ")}`,
      explanation: `The code uses ${names.join(" and ")}, all ${job} services. Apps usually need one. The others may be a migration in progress, a leftover, or a deliberate split.`,
      whyItMatters: "Each service is an account, a key, a bill and a limit to watch. A leftover one costs money and attention for nothing.",
      severity: "low",
      confidence: "proven",
      category: "redundancy",
      location: null,
      evidence: { advisories: [], rule: `More than one service in the ${category} category of the catalog` },
      actionKind: "steps",
      steps: [{ title: "Decide which one stays", detail: "If the split is deliberate, say so in a decision so no agent asks again. If not, remove the SDK and the keys of the one that goes." }],
      fixPlan: null,
    });
  }

  return out;
}

/** Config files, type declarations and scripts: never counted as unreached code. */
const NOT_CODE_TO_REACH = /\.d\.ts$|(^|\/)(next|tailwind|postcss|vitest|vite|eslint|jest|playwright|capacitor|app)\.config\.[a-z]+$|(^|\/)(scripts?|bin|tools?)\//;

export const gapsCheck: Check = {
  id: "gaps",
  step: "gaps",
  label: "Checking the map for gaps, redundancies and stale code",
  scope: "The map against itself: crons without a handler or a secret check, webhooks without a sender check, an SDK with no key named, env names declared but never read, packages listed but never imported, files no page or route reaches, two services for one job.",
  available: () => true,
  async run(ctx: CheckContext): Promise<FindingDraft[]> {
    const { map, mapContext } = ctx;
    if (!map || !mapContext) return [];
    const { graph, files, units } = mapContext;
    const runtimeDependencies: Array<{ name: string; manifestPath: string }> = [];
    for (const unit of map.units) {
      const manifestPath = unit.path ? `${unit.path}/package.json` : "package.json";
      if (!files.has(manifestPath)) continue;
      try {
        const pkg = JSON.parse(await ctx.read(manifestPath)) as { dependencies?: Record<string, string> };
        for (const name of Object.keys(pkg.dependencies ?? {})) runtimeDependencies.push({ name, manifestPath });
      } catch {
        // A manifest birdsI cannot read has no packages to count.
      }
    }
    const entries = graph.entries.map((e) => e.file);
    const reached = reach(graph, entries);
    const sourceDirs = units.flatMap((u) => [u.appDir, u.pagesDir].filter((d): d is string => d !== null).map((d) => d.replace(/\/(app|pages)$/, "")));
    const unreached = files
      .code()
      .filter((path) => sourceDirs.some((dir) => path.startsWith(`${dir}/`)) && !reached.has(path) && !entries.includes(path) && !NOT_CODE_TO_REACH.test(path));
    return findGaps({ map, runtimeDependencies, importedPackages: new Set(graph.packageImports.keys()), unreached, hasEntries: graph.entries.length > 0 });
  },
};
