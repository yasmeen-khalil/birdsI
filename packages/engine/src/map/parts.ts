import type { MapCron, MapMigrations, MapPublicSurface, MapStoreApp, MapWebhook, MigrationMarker, SourceLine } from "@birdsi/shared";
import { dirOf, lineAt, sourceLine, type MapFiles } from "./files";
import { isWebhookRoute, reach, type Graph, type Unit } from "./graph";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const pad = (n: number) => String(n).padStart(2, "0");

/** A cron schedule in words, and how many times a day it runs when that is plain. */
export function describeSchedule(expr: string): { every: string; perDay: number | null } {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) return { every: `on the schedule ${expr}`, perDay: null };
  const [min, hour, dom, mon, dow] = f as [string, string, string, string, string];
  const num = (s: string) => (/^\d+$/.test(s) ? Number(s) : null);
  const step = (s: string) => (/^\*\/\d+$/.test(s) ? Number(s.slice(2)) : null);
  const list = (s: string) => (/^\d+(,\d+)+$/.test(s) ? s.split(",").map(Number) : null);
  const anyDay = dom === "*" && mon === "*" && dow === "*";
  if (anyDay && step(min) && hour === "*") return { every: `every ${step(min)} minutes`, perDay: Math.floor(1440 / step(min)!) };
  if (anyDay && min === "*" && hour === "*") return { every: "every minute", perDay: 1440 };
  if (anyDay && num(min) !== null && hour === "*") return { every: `every hour at minute ${num(min)}`, perDay: 24 };
  if (anyDay && num(min) !== null && step(hour)) return { every: `every ${step(hour)} hours at minute ${num(min)}`, perDay: Math.floor(24 / step(hour)!) };
  if (anyDay && num(min) !== null && num(hour) !== null) return { every: `every day at ${pad(num(hour)!)}:${pad(num(min)!)} UTC`, perDay: 1 };
  if (anyDay && num(min) !== null && list(hour)) return { every: `every day at ${list(hour)!.map((h) => `${pad(h)}:${pad(num(min)!)}`).join(", ")} UTC`, perDay: list(hour)!.length };
  if (dom === "*" && mon === "*" && num(dow) !== null && num(min) !== null && num(hour) !== null) return { every: `every ${DAYS[num(dow)! % 7]} at ${pad(num(hour)!)}:${pad(num(min)!)} UTC`, perDay: 1 / 7 };
  if (num(dom) !== null && mon === "*" && dow === "*" && num(min) !== null && num(hour) !== null) return { every: `on day ${num(dom)} of every month at ${pad(num(hour)!)}:${pad(num(min)!)} UTC`, perDay: 1 / 30 };
  return { every: `on the schedule ${expr}`, perDay: null };
}

function routeFile(files: MapFiles, unit: Unit, path: string): string | null {
  const clean = path.split("?")[0]!.replace(/\/$/, "");
  const candidates: string[] = [];
  if (unit.appDir) for (const ext of ["ts", "js", "tsx", "jsx", "mjs"]) candidates.push(`${unit.appDir}${clean}/route.${ext}`);
  if (unit.pagesDir) for (const ext of ["ts", "js"]) candidates.push(`${unit.pagesDir}${clean}.${ext}`, `${unit.pagesDir}${clean}/index.${ext}`);
  return candidates.find((c) => files.has(c)) ?? null;
}

export async function readCrons(files: MapFiles, units: Unit[], graph: Graph): Promise<MapCron[]> {
  const out: MapCron[] = [];
  for (const path of [...files.paths].filter((p) => /(^|\/)vercel\.json$/.test(p)).sort()) {
    const content = await files.text(path);
    if (!content) continue;
    let crons: Array<{ path?: unknown; schedule?: unknown }> = [];
    try {
      crons = ((JSON.parse(content) as { crons?: unknown }).crons as typeof crons) ?? [];
    } catch {
      continue;
    }
    const unit = units.find((u) => u.path === dirOf(path)) ?? units[0];
    for (const c of Array.isArray(crons) ? crons : []) {
      if (typeof c.path !== "string" || typeof c.schedule !== "string") continue;
      const at = content.indexOf(`"${c.path}"`);
      const handler = unit ? routeFile(files, unit, c.path) : null;
      // The handler or a helper it imports checks the bearer Vercel sends.
      let checksSecret = false;
      for (const file of handler ? reach(graph, [handler]) : []) {
        if ((await files.text(file))?.includes("CRON_SECRET")) {
          checksSecret = true;
          break;
        }
      }
      out.push({
        path: c.path,
        schedule: c.schedule,
        ...describeSchedule(c.schedule),
        source: sourceLine(path, content, at >= 0 ? lineAt(content, at) : 1),
        handler,
        checksSecret,
      });
    }
  }
  return out;
}

/** A line that checks a signature or a shared secret; a header read alone counts only when nothing stronger is there. */
const VERIFY_STRONG = /constructEvent(Async)?\(|webhooks?\.verify|\.verify\(|new Webhook\(|\bverify(Webhook|Signature)?\(|timingSafeEqual|createHmac/;
const VERIFY_WEAK = /svix|stripe-signature|x-hub-signature|authorization/i;

/** The vendor a webhook route serves: its folders first, then what the file imports and reads. */
function webhookService(route: string, content: string): string | null {
  const segments = route.toLowerCase().split("/");
  const named: Array<[RegExp, string]> = [
    [/^stripe$/, "stripe"],
    [/^clerk$/, "clerk"],
    [/^revenuecat$/, "revenuecat"],
    [/^resend$/, "resend"],
    [/^github$/, "github"],
    [/^onesignal$/, "onesignal"],
    [/^supabase$/, "supabase"],
    [/^lemon-?squeezy$/, "lemon-squeezy"],
    [/^paddle$/, "paddle"],
    [/^twilio$/, "twilio"],
  ];
  for (const s of segments) for (const [re, slug] of named) if (re.test(s)) return slug;
  if (/from\s+["']stripe["']|STRIPE_WEBHOOK_SECRET|constructEvent/.test(content)) return "stripe";
  if (/CLERK_WEBHOOK_SECRET|@clerk\/|WebhookEvent/.test(content)) return "clerk";
  if (/REVENUECAT/i.test(content)) return "revenuecat";
  if (/RESEND_WEBHOOK|from\s+["']resend["']/.test(content)) return "resend";
  if (/GITHUB_WEBHOOK_SECRET|x-hub-signature/i.test(content)) return "github";
  return null;
}

export async function readWebhooks(files: MapFiles, graph: Graph): Promise<MapWebhook[]> {
  const out: MapWebhook[] = [];
  for (const entry of graph.entries.filter(isWebhookRoute)) {
    const content = (await files.text(entry.file)) ?? "";
    const lines = content.split("\n");
    const code = (l: string) => !/^\s*(\/\/|\*|\/\*|import\b)/.test(l);
    const strong = lines.findIndex((l) => VERIFY_STRONG.test(l) && code(l));
    const at = strong >= 0 ? strong : lines.findIndex((l) => VERIFY_WEAK.test(l) && code(l));
    const methods = [...content.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]!);
    out.push({ route: entry.route, file: entry.file, service: webhookService(entry.route, content), verifies: at >= 0 ? sourceLine(entry.file, content, at + 1) : null, methods: [...new Set(methods)] });
  }
  return out.sort((a, b) => a.route.localeCompare(b.route));
}

export async function readStoreApps(files: MapFiles): Promise<MapStoreApp[]> {
  const out: MapStoreApp[] = [];
  const all = [...files.paths];
  for (const path of all.filter((p) => /(^|\/)capacitor\.config\.(ts|js|json)$/.test(p))) {
    const content = await files.text(path);
    if (!content) continue;
    const pick = (key: string) => content.match(new RegExp(`["']?${key}["']?\\s*:\\s*["']([^"']+)["']`))?.[1] ?? null;
    const appId = pick("appId");
    const at = content.search(/appId/);
    out.push({ platform: "capacitor", bundleId: appId, appName: pick("appName"), webUrl: pick("url"), source: sourceLine(path, content, at >= 0 ? lineAt(content, at) : 1) });
  }
  for (const path of all.filter((p) => /\.xcodeproj\/project\.pbxproj$/.test(p))) {
    const content = await files.text(path);
    const m = content?.match(/PRODUCT_BUNDLE_IDENTIFIER = "?([A-Za-z0-9.-]+)"?;/);
    if (content && m) out.push({ platform: "ios", bundleId: m[1]!, appName: null, webUrl: null, source: sourceLine(path, content, lineAt(content, m.index ?? 0)) });
  }
  for (const path of all.filter((p) => /(^|\/)app\/build\.gradle(\.kts)?$/.test(p))) {
    const content = await files.text(path);
    const m = content?.match(/applicationId\s*=?\s*["']([A-Za-z0-9._]+)["']/);
    if (content && m) out.push({ platform: "android", bundleId: m[1]!, appName: null, webUrl: null, source: sourceLine(path, content, lineAt(content, m.index ?? 0)) });
  }
  for (const path of all.filter((p) => /(^|\/)app\.json$/.test(p))) {
    const content = await files.text(path);
    if (!content || !content.includes('"expo"')) continue;
    try {
      const expo = (JSON.parse(content) as { expo?: { name?: string; ios?: { bundleIdentifier?: string }; android?: { package?: string } } }).expo;
      if (expo?.ios?.bundleIdentifier) out.push({ platform: "expo", bundleId: expo.ios.bundleIdentifier, appName: expo.name ?? null, webUrl: null, source: sourceLine(path, content, lineAt(content, content.indexOf("bundleIdentifier"))) });
    } catch {
      // Not readable JSON.
    }
  }
  // The app template's identity file names the bundle id the store record uses.
  for (const path of all.filter((p) => /(^|\/)app\.config\.ts$/.test(p))) {
    const content = await files.text(path);
    const id = content?.match(/bundleId:\s*["']([A-Za-z0-9.-]+)["']/);
    if (content && id) {
      const name = content.match(/\bname:\s*["']([^"']+)["']/)?.[1] ?? null;
      out.push({ platform: "ios", bundleId: id[1]!, appName: name, webUrl: null, source: sourceLine(path, content, lineAt(content, id.index ?? 0)) });
    }
  }
  // One entry per store app: the files that name the same bundle id are merged, and a Capacitor config
  // whose id is an expression (APP.bundleId) joins the one Apple app the other files name.
  const merged: MapStoreApp[] = [];
  const family = (a: MapStoreApp) => (a.platform === "android" ? "android" : "apple");
  for (const a of out.filter((x) => x.bundleId)) {
    const same = merged.find((m) => family(m) === family(a) && m.bundleId === a.bundleId);
    if (!same) merged.push({ ...a });
    else {
      same.appName ??= a.appName;
      same.webUrl ??= a.webUrl;
      if (a.platform === "capacitor") same.platform = "capacitor";
    }
  }
  for (const a of out.filter((x) => !x.bundleId)) {
    const apple = merged.filter((m) => family(m) === "apple");
    if (apple.length === 1) {
      apple[0]!.appName ??= a.appName;
      apple[0]!.webUrl ??= a.webUrl;
      apple[0]!.platform = "capacitor";
    } else merged.push(a);
  }
  return merged;
}

const MARKER = /\(\s*'((?:[^']|'')*)'\s*,\s*'([a-z_]+)'\s*,\s*'((?:[^']|'')*)'\s*,\s*(null|'(?:[^']|'')*')\s*\)/g;

export function parseMarkers(sql: string): MigrationMarker[] {
  const out: MigrationMarker[] = [];
  const values = sql.slice(sql.search(/\bvalues\b/i));
  for (const m of values.matchAll(MARKER)) {
    const unq = (s: string) => s.replace(/''/g, "'");
    out.push({ migration: unq(m[1]!), kind: m[2]!, name: unq(m[3]!), col: m[4] === "null" ? null : unq(m[4]!.slice(1, -1)) });
  }
  return out;
}

export async function readMigrations(files: MapFiles): Promise<MapMigrations> {
  const all = [...files.paths].filter((p) => p.endsWith(".sql"));
  const cli = all.filter((p) => /(^|\/)supabase\/migrations\/\d{14}_[^/]+\.sql$/.test(p)).sort();
  const numbered = all.filter((p) => /(^|\/)(supabase\/)?migrations\/\d{3,5}_[^/]+\.sql$/.test(p)).sort();
  const versioned = all
    .filter((p) => /(^|\/)supabase-v\d+\.sql$/.test(p))
    .sort((a, b) => Number(a.match(/v(\d+)\.sql$/)![1]) - Number(b.match(/v(\d+)\.sql$/)![1]));
  let style: MapMigrations["style"] = null;
  let chosen: string[] = [];
  if (cli.length > 0) [style, chosen] = ["supabase-cli", cli];
  else if (numbered.length > 0) [style, chosen] = ["numbered", numbered];
  else if (versioned.length > 0) {
    style = "versioned";
    const base = all.find((p) => /(^|\/)supabase-schema\.sql$/.test(p) && dirOf(p) === dirOf(versioned[0]!));
    chosen = [...(base ? [base] : []), ...versioned];
  }
  const verifyPath = all.filter((p) => /(^|\/)(supabase-)?verify\.sql$/.test(p)).sort((a, b) => a.split("/").length - b.split("/").length)[0] ?? null;
  const verifyText = verifyPath ? await files.text(verifyPath) : null;
  let record: MapMigrations["record"] = null;
  for (const p of chosen) {
    const text = await files.text(p);
    const m = text?.match(/create\s+table\s+(if\s+not\s+exists\s+)?(public\.)?schema_migrations\b/i);
    if (text && m) {
      record = { table: "public.schema_migrations", source: sourceLine(p, text, lineAt(text, m.index ?? 0)) };
      break;
    }
  }
  return {
    style,
    dir: chosen.length > 0 ? dirOf(chosen[chosen.length - 1]!) || "." : null,
    files: chosen.map((p) => ({ name: p.slice(p.lastIndexOf("/") + 1), path: p })),
    verify: verifyPath && verifyText ? { path: verifyPath, markers: parseMarkers(verifyText) } : null,
    record,
  };
}

export async function readPublicSurface(files: MapFiles, units: Unit[]): Promise<MapPublicSurface> {
  const find = async (patterns: RegExp[]): Promise<SourceLine | null> => {
    for (const unit of units) {
      for (const path of files.paths) {
        if (unit.path && !path.startsWith(`${unit.path}/`)) continue;
        const rel = unit.path ? path.slice(unit.path.length + 1) : path;
        if (patterns.some((re) => re.test(rel))) return { path, line: 1, text: rel };
      }
    }
    return null;
  };
  return {
    sitemap: await find([/^(src\/)?app\/sitemap\.(ts|js|xml)$/, /^public\/sitemap\.xml$/, /^(src\/)?pages\/sitemap\.xml\.(ts|js)$/]),
    robots: await find([/^(src\/)?app\/robots\.(ts|js|txt)$/, /^public\/robots\.txt$/]),
    llmsTxt: await find([/^(src\/)?app\/llms\.txt(\/route\.(ts|js))?$/, /^public\/llms\.txt$/]),
  };
}
