import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { collectDependencies } from "../inventory/manifests";
import { walkInventory } from "../inventory/walk";
import { buildServiceMapWithContext } from "../map/index";
import type { ModelClient } from "../models/client";
import { discoverVendors } from "../vendors/discover";
import { batchSegments, segmentsOf } from "./chunks";
import { readable, readWithModel } from "./index";
import type { Find } from "./schema";
import { confirmFind } from "./verify";

const fixture = resolve(import.meta.dirname, "../../fixtures/cockpit-app");

interface Call {
  purpose: string;
  user: string;
}

/** A model that answers from a script: the finds for the first reading pass, and a purpose for every service listed. */
function fakeModel(finds: Find[]): { models: ModelClient; calls: Call[] } {
  const calls: Call[] = [];
  let passes = 0;
  const models = {
    available: true,
    modelId: () => "fake-nano",
    complete: async (opts: { purpose: string; user: string }) => {
      calls.push({ purpose: opts.purpose, user: opts.user });
      if (opts.purpose === "reader") return { finds: passes++ === 0 ? finds : [] };
      if (opts.purpose === "purposes") return { purposes: [...opts.user.matchAll(/^- (\S+) \(/gm)].map((m) => ({ slug: m[1]!, purpose: `used for ${m[1]}` })) };
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

  it("confirms a quote on its line and refuses a wrong line, a wrong quote or a name that is not on the line", () => {
    expect(confirmFind(find({}), content)).toMatchObject({ path: "x.ts", line: 2 });
    expect(confirmFind(find({ line: 1 }), content)).toBeNull();
    expect(confirmFind(find({ quote: "process.env.OTHER" }), content)).toBeNull();
    expect(confirmFind(find({ name: "MAPBOX" }), content)).toBeNull();
    expect(confirmFind(find({ line: 9 }), content)).toBeNull();
    expect(confirmFind(find({}), null)).toBeNull();
  });

  it("ignores spacing differences", () => {
    expect(confirmFind(find({ quote: "const   token = process.env.MAPBOX_TOKEN" }), content)).not.toBeNull();
  });
});
