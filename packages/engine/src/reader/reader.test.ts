import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { collectDependencies } from "../inventory/manifests";
import { walkInventory } from "../inventory/walk";
import { buildServiceMapWithContext } from "../map/index";
import { OutputLimitError, type ModelClient } from "../models/client";
import { discoverVendors } from "../vendors/discover";
import { batchSegments, segmentsOf } from "./chunks";
import { readable, readerNote, readWithModel } from "./index";
import type { Find } from "./schema";
import type { ServiceMap } from "@birdsi/shared";
import { alreadyKnown, cleanPath, confirmFind } from "./verify";

const fixture = resolve(import.meta.dirname, "../../fixtures/cockpit-app");

interface Call {
  purpose: string;
  system: string;
  user: string;
}

/** A model that answers from a script: the finds for the first reading pass, and a purpose for every service listed. */
function fakeModel(finds: Find[]): { models: ModelClient; calls: Call[] } {
  const calls: Call[] = [];
  let passes = 0;
  const models = {
    available: true,
    modelId: () => "fake-nano",
    complete: async (opts: { purpose: string; system: string; user: string }) => {
      calls.push({ purpose: opts.purpose, system: opts.system, user: opts.user });
      if (opts.purpose === "reader") return { finds: passes++ === 0 ? finds : [] };
      if (opts.purpose === "purposes") return { purposes: [...opts.user.matchAll(/^- (\S+) \(/gm)].map((m) => ({ slug: m[1]!, purpose: `used for ${m[1]}` })) };
      throw new Error(`unexpected purpose ${opts.purpose}`);
    },
  } as unknown as ModelClient;
  return { models, calls };
}

/** A model whose thinking runs past the budget on any pass with more than one file, and answers on a single file. */
function overthinkingModel(finds: Find[]): { models: ModelClient; calls: Call[] } {
  const calls: Call[] = [];
  let answered = 0;
  const models = {
    available: true,
    modelId: () => "fake-nano",
    complete: async (opts: { purpose: string; system: string; user: string }) => {
      calls.push({ purpose: opts.purpose, system: opts.system, user: opts.user });
      if (opts.purpose === "reader") {
        if ((opts.user.match(/^### /gm) ?? []).length > 1) throw new OutputLimitError("The model's thinking ran past the output budget before it answered (reader).");
        return { finds: answered++ === 0 ? finds : [] };
      }
      if (opts.purpose === "purposes") return { purposes: [] };
      throw new Error(`unexpected purpose ${opts.purpose}`);
    },
  } as unknown as ModelClient;
  return { models, calls };
}

async function rulesMap() {
  const inventory = await walkInventory(fixture);
  const deps = await collectDependencies(inventory);
  const vendors = await discoverVendors(inventory, deps, null);
  const built = await buildServiceMapWithContext(inventory, deps, vendors, { commit: "abc1234", branch: "main", readAt: "2026-10-27T12:00:00.000Z" });
  return { inventory, map: built.map, context: built.context };
}

const emit = async () => {};
const signal = new AbortController().signal;

const FINDS: Find[] = [
  { kind: "env", name: "MAPBOX_TOKEN", detail: "The Mapbox token for the map tiles", category: null, schedule: null, path: "src/lib/maps.ts", line: 4, quote: 'return setting("MAPBOX_TOKEN")' },
  { kind: "service", name: "Mapbox", detail: "Draws the map tiles", category: "maps", schedule: null, path: "src/lib/maps.ts", line: 4, quote: 'setting("MAPBOX_TOKEN")' },
  { kind: "cron", name: "Nightly report", detail: "Runs the nightly report", category: null, schedule: "0 3 * * *", path: ".github/workflows/nightly.yml", line: 4, quote: '- cron: "0 3 * * *"' },
  { kind: "service", name: "Fakeservice", detail: "Not real", category: "other", schedule: null, path: "src/lib/email.ts", line: 1, quote: "nothing like this is on the line" },
  { kind: "env", name: "CRON_SECRET", detail: "Already on the map", category: null, schedule: null, path: "src/app/api/cron/digest/route.ts", line: 2, quote: "process.env.CRON_SECRET" },
];

describe("the model's reading of the fixture app", () => {
  it("confirms each find at its line, merges it into the map, and drops what the line does not say", async () => {
    const { inventory, map, context } = await rulesMap();
    expect(map.env.some((e) => e.name === "MAPBOX_TOKEN")).toBe(false);
    const { models, calls } = fakeModel(FINDS);
    const { map: read, stats } = await readWithModel({ inventory, map, context, models, previous: null, maxInputTokens: 4_000_000, concurrency: 2, emit, signal });
    expect(stats).toMatchObject({ model: "fake-nano", finds: 5, confirmed: 3, dropped: 1, known: 1, carried: 0, filesUnchanged: 0, filesOverBudget: 0 });
    expect(stats.batches).toBeGreaterThan(0);
    expect(calls.filter((c) => c.purpose === "reader")).toHaveLength(stats.batches);

    const env = read.env.find((e) => e.name === "MAPBOX_TOKEN")!;
    expect(env.found).toMatchObject({ by: "model", model: "fake-nano", at: { path: "src/lib/maps.ts", line: 4 } });
    expect(env.service).toBe("mapbox");
    expect(env.reads[0]!.text).toContain("MAPBOX_TOKEN");

    const mapbox = read.services.find((s) => s.slug === "mapbox")!;
    expect(mapbox.how).toEqual(["model"]);
    expect(mapbox.category).toBe("maps");
    expect(mapbox.found?.at.line).toBe(4);
    expect(mapbox.purpose).toBe("Draws the map tiles");

    expect(read.crons).toHaveLength(3);
    expect(read.crons.find((c) => c.kind === "actions")).toMatchObject({ path: "Nightly report", schedule: "0 3 * * *", every: "every day at 03:00 UTC", perDay: 1, handler: null, checksSecret: false });
    expect(read.services.find((s) => s.slug === "fakeservice")).toBeUndefined();
    expect(read.modelFinds.map((f) => [f.kind, f.name, f.merged])).toEqual([
      ["env", "MAPBOX_TOKEN", true],
      ["service", "Mapbox", true],
      ["cron", "Nightly report", true],
    ]);
    expect(Object.keys(read.fileHashes).length).toBeGreaterThan(5);
    expect(read.reader?.confirmed).toBe(3);
    expect(read.services.find((s) => s.slug === "stripe")?.purpose).toBe("used for stripe");
  });

  it("reads a pass again in halves when the model's thinking runs past the budget", async () => {
    const { inventory, map, context } = await rulesMap();
    const { models, calls } = overthinkingModel(FINDS);
    const { stats } = await readWithModel({ inventory, map, context, models, previous: null, maxInputTokens: 4_000_000, concurrency: 2, emit, signal });
    expect(stats.split).toBeGreaterThan(0);
    expect(stats.confirmed).toBe(3);
    const passes = calls.filter((c) => c.purpose === "reader");
    expect(passes.length).toBeGreaterThan(stats.batches);
    expect(passes.filter((c) => (c.user.match(/^### /gm) ?? []).length === 1).length).toBeGreaterThan(0);
    expect(readerNote(stats)).toContain("read again in halves");
  });

  it("reads nothing again when no file changed, and carries the previous finds over", async () => {
    const first = await rulesMap();
    const previous = (await readWithModel({ ...first, models: fakeModel(FINDS).models, previous: null, maxInputTokens: 4_000_000, concurrency: 2, emit, signal })).map;
    const second = await rulesMap();
    const again = fakeModel(FINDS);
    const { map: read, stats } = await readWithModel({ ...second, models: again.models, previous, maxInputTokens: 4_000_000, concurrency: 2, emit, signal });
    expect(again.calls).toHaveLength(0);
    expect(stats).toMatchObject({ filesRead: 0, batches: 0, finds: 0, carried: 3 });
    expect(stats.filesUnchanged).toBeGreaterThan(5);
    expect(read.env.find((e) => e.name === "MAPBOX_TOKEN")?.found?.by).toBe("model");
    expect(read.crons).toHaveLength(3);
    expect(read.services.find((s) => s.slug === "stripe")?.purpose).toBe("used for stripe");
  });

  it("adds the owner's words to the prompts of the reading and the purposes", async () => {
    const { inventory, map, context } = await rulesMap();
    const { models, calls } = fakeModel([]);
    await readWithModel({ inventory, map, context, models, previous: null, maxInputTokens: 4_000_000, concurrency: 2, prompts: { reader: "Ignore the scripts folder.", purposes: "Call users members." }, emit, signal });
    expect(calls.find((c) => c.purpose === "reader")?.system).toContain("The owner adds, for this app: Ignore the scripts folder.");
    expect(calls.find((c) => c.purpose === "purposes")?.system).toContain("The owner adds, for this app: Call users members.");
  });

  it("stops at the reading budget and counts the files that wait", async () => {
    const { inventory, map, context } = await rulesMap();
    const { models, calls } = fakeModel([]);
    const { stats } = await readWithModel({ inventory, map, context, models, previous: null, maxInputTokens: 1, concurrency: 2, emit, signal });
    expect(stats.batches).toBe(0);
    expect(stats.filesOverBudget).toBeGreaterThan(0);
    expect(calls.filter((c) => c.purpose === "reader")).toHaveLength(0);
  });
});

describe("what the model reads", () => {
  it("takes code, configuration and workflows, and leaves tests and docs", () => {
    expect(readable({ path: "src/lib/a.ts", bytes: 10, language: "TypeScript" })).toBe(true);
    expect(readable({ path: ".github/workflows/x.yml", bytes: 10, language: "YAML" })).toBe(true);
    expect(readable({ path: ".env.example", bytes: 10, language: "Env" })).toBe(true);
    expect(readable({ path: "src/lib/a.test.ts", bytes: 10, language: "TypeScript" })).toBe(false);
    expect(readable({ path: "README.md", bytes: 10, language: "Markdown" })).toBe(false);
    expect(readable({ path: "package-lock.json", bytes: 10, language: "JSON" })).toBe(false);
  });
});

describe("chunks", () => {
  it("numbers every line from its place in the file and splits long files", () => {
    const content = Array.from({ length: 60_000 }, (_, i) => `line ${i + 1}`).join("\n");
    const segments = segmentsOf("big.ts", content);
    expect(segments.length).toBeGreaterThan(1);
    expect(segments[0]).toMatchObject({ startLine: 1, totalLines: 60_000 });
    expect(segments[1]!.startLine).toBe(segments[0]!.endLine + 1);
    expect(segments[1]!.text.startsWith(`${segments[1]!.startLine}| line ${segments[1]!.startLine}`)).toBe(true);
    const batches = batchSegments(segments);
    expect(batches.every((b) => b.chars <= 180_000 || b.segments.length === 1)).toBe(true);
  });
});

describe("confirmFind", () => {
  const content = "const a = 1\nconst token = process.env.MAPBOX_TOKEN\n";
  const find = (over: Partial<Find>): Find => ({ kind: "env", name: "MAPBOX_TOKEN", detail: "", category: null, schedule: null, path: "x.ts", line: 2, quote: "process.env.MAPBOX_TOKEN", ...over });

  it("confirms a quote on its line and refuses a wrong quote, a name that is not on the line or a line the file lacks", () => {
    expect(confirmFind(find({}), content)).toMatchObject({ path: "x.ts", line: 2 });
    expect(confirmFind(find({ quote: "process.env.OTHER" }), content)).toBeNull();
    expect(confirmFind(find({ name: "MAPBOX" }), content)).toBeNull();
    expect(confirmFind(find({ line: 9 }), content)).toBeNull();
    expect(confirmFind(find({}), null)).toBeNull();
  });

  it("confirms the quote at a neighbouring line and records that line, but not further away", () => {
    expect(confirmFind(find({ line: 1 }), content)).toMatchObject({ path: "x.ts", line: 2 });
    expect(confirmFind(find({ line: 4 }), content)).toMatchObject({ path: "x.ts", line: 2 });
    expect(confirmFind(find({ line: 5 }), content)).toBeNull();
  });

  it("wants every word of the name on the line, and takes a timer line as a cron's proof", () => {
    const table = 'const rows = [{ version: "v70", file: "supabase-v70.sql" }];\n';
    expect(confirmFind(find({ kind: "migration", name: "supabase-v73.sql", line: 1, quote: "{ version: " }), table)).toBeNull();
    expect(confirmFind(find({ kind: "migration", name: "supabase-v70.sql", line: 1, quote: "{ version: " }), table)).toMatchObject({ line: 1 });
    const timer = "const iv = setInterval(() => poll(id), 5000);\n";
    expect(confirmFind(find({ kind: "cron", name: "devActivityPoll", line: 1, quote: "const iv = setInterval(() => poll(id), 5000);" }), timer)).toMatchObject({ line: 1 });
    expect(confirmFind(find({ kind: "service", name: "Wikipedia", line: 1, quote: "const iv = setInterval(() => poll(id), 5000);" }), timer)).toBeNull();
  });

  it("wants an env name read as one, and a service from a package, not from the app's own files", () => {
    expect(confirmFind(find({ line: 1, quote: "import { MAPBOX_TOKEN } from './config';" }), "import { MAPBOX_TOKEN } from './config';\n")).toBeNull();
    expect(confirmFind(find({ line: 1, quote: 'return setting("MAPBOX_TOKEN")' }), 'return setting("MAPBOX_TOKEN")\n')).toMatchObject({ line: 1 });
    expect(confirmFind(find({ line: 1, quote: "const t = env.MAPBOX_TOKEN;" }), "const t = env.MAPBOX_TOKEN;\n")).toMatchObject({ line: 1 });
    expect(confirmFind(find({ line: 1, quote: 'Deno.env.get("MAPBOX_TOKEN")' }), 'const t = Deno.env.get("MAPBOX_TOKEN");\n')).toMatchObject({ line: 1 });
    const own = "import { sendPush } from './push';\n";
    expect(confirmFind(find({ kind: "service", name: "push", line: 1, quote: own.trim() }), own)).toBeNull();
    const pkg = "import { Webhook } from 'svix';\n";
    expect(confirmFind(find({ kind: "service", name: "svix", line: 1, quote: pkg.trim() }), pkg)).toMatchObject({ line: 1 });
  });

  it("names a store app by a store config file only, and a path by its whole parts", () => {
    const line = "<string>com.example.bakery</string>\n";
    const app = (path: string) => find({ kind: "store_app", name: "com.example.bakery", line: 1, quote: "<string>com.example.bakery</string>", path });
    expect(confirmFind(app("app/ios/App/App/Info.plist"), line)).toMatchObject({ line: 1 });
    expect(confirmFind(app("app/ios/App/CapApp-SPM/.gitignore"), "ios .DS_Store\n")).toBeNull();
    const hook = find({ kind: "webhook", name: "/api/hooks/stripe", line: 1, quote: "export async function POST() {" });
    expect(confirmFind({ ...hook, path: "app/api/hooks/stripe/route.ts" }, "export async function POST() {\n")).toMatchObject({ line: 1 });
    expect(confirmFind({ ...hook, path: "app/components/Stripes.tsx" }, "export async function POST() {\n")).toBeNull();
  });

  it("cleans a path copied with the heading's marks and line range", () => {
    expect(cleanPath("### app/supabase-v42.sql (lines 1 to 28 of 28)")).toBe("app/supabase-v42.sql");
    expect(cleanPath("app/src/lib/actions.ts")).toBe("app/src/lib/actions.ts");
  });

  it("knows a Vercel cron by its handler file", () => {
    const cron = { path: "/api/cron/daily-specials", schedule: "0 6 * * *", source: { path: "vercel.json", line: 3, text: "" }, handler: "app/api/cron/daily-specials/route.ts" };
    const map = { crons: [cron] } as unknown as ServiceMap;
    const at = { path: "app/api/cron/daily-specials/route.ts", line: 4, text: "// Runs every morning" };
    expect(alreadyKnown(map, find({ kind: "cron", name: "daily-specials", schedule: null }), at)).toBe(true);
    expect(alreadyKnown(map, find({ kind: "cron", name: "daily-specials", schedule: null }), { ...at, path: "app/api/other/route.ts" })).toBe(false);
  });

  it("ignores spacing and quote mark differences", () => {
    expect(confirmFind(find({ quote: "const   token = process.env.MAPBOX_TOKEN" }), content)).not.toBeNull();
    const quoted = 'const stripe = new Stripe(key, { apiVersion: "2023-10-16" });\n';
    const stripe = find({ kind: "service", name: "Stripe", line: 1, quote: "new Stripe(key, { apiVersion: '2023-10-16' })" });
    expect(confirmFind(stripe, quoted)).toMatchObject({ line: 1, text: quoted.trim() });
    const posted = 'axios.post("https://api.emailservice.example/v1/send", {\n';
    const mangled = find({ kind: "service", name: "email service", line: 1, quote: "axios.post($#34#91;https://api.emailservice.example/v1/send$#34#93$, {" });
    expect(confirmFind(mangled, posted)).toMatchObject({ line: 1 });
  });
});
