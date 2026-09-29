import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { en, locales } from "./index";

const EM_DASH = /—/;
/** Pictographic emoji only; plain symbols such as check marks and glyph rings are allowed in terminals. */
const EMOJI = /\p{Extended_Pictographic}/u;

function leaves(obj: unknown, path: string[] = []): Array<[string, string]> {
  if (typeof obj === "string") return [[path.join("."), obj]];
  if (obj && typeof obj === "object") return Object.entries(obj).flatMap(([k, v]) => leaves(v, [...path, k]));
  return [];
}

describe("copy dictionary", () => {
  it("has no empty strings, em dashes or emojis", () => {
    for (const [key, value] of leaves(en)) {
      expect(value.trim(), key).not.toBe("");
      expect(EM_DASH.test(value), `${key} contains an em dash`).toBe(false);
      expect(EMOJI.test(value), `${key} contains an emoji`).toBe(false);
    }
  });

  it("every locale has exactly the same keys", () => {
    const reference = leaves(en).map(([k]) => k).sort();
    for (const [name, dict] of Object.entries(locales)) {
      expect(leaves(dict).map(([k]) => k).sort(), name).toEqual(reference);
    }
  });
});

/** Walks the web app and CLI sources so inline copy follows the same rules. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === "dist") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(tsx?|md)$/.test(entry) && !entry.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

describe("inline UI copy", () => {
  const root = join(import.meta.dirname, "..", "..", "..", "..");
  const dirs = [join(root, "apps", "web", "src"), join(root, "packages", "cli", "src"), join(root, "packages", "engine", "src")].filter((d) => {
    try {
      return statSync(d).isDirectory();
    } catch {
      return false;
    }
  });

  it("uses no em dashes or emojis in source strings", () => {
    const offenders: string[] = [];
    for (const dir of dirs) {
      for (const file of sourceFiles(dir)) {
        const text = readFileSync(file, "utf8");
        const lines = text.split("\n");
        lines.forEach((line, i) => {
          if (EM_DASH.test(line) || EMOJI.test(line)) offenders.push(`${file.replace(root + "/", "")}:${i + 1}`);
        });
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
