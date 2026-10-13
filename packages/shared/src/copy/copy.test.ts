import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { en, locales } from "./index";

const EM_DASH = /—/;
/** Pictographic emoji only; plain symbols such as check marks and glyph rings are allowed in terminals. */
const EMOJI = /\p{Extended_Pictographic}/u;

/**
 * Punctuation the house style leaves out of anything a person reads: semicolons and exclamation marks.
 * Code-shaped text is let through: HTML entities, shell control words, a bare separator character,
 * and Tailwind's important modifier (`max-[900px]:hidden!`), which always carries a variant or bracket.
 */
function proseFlaws(text: string): string[] {
  const flaws: string[] = [];
  const plain = text.replace(/&#?\w+;/g, " ").replace(/;\s*(then|fi|do|done|else)\b/g, " ");
  if (/;\s/.test(plain) || /\p{L}[)"'’»]?;$/u.test(plain)) flaws.push("a semicolon");
  for (const token of plain.split(/\s+/)) {
    const bare = token.replace(/["'’»)\].,]+$/, "");
    if (/\p{L}!$/u.test(bare) && !/[:[]/.test(bare)) {
      flaws.push("an exclamation mark");
      break;
    }
  }
  return flaws;
}

function leaves(obj: unknown, path: string[] = []): Array<[string, string]> {
  if (typeof obj === "string") return [[path.join("."), obj]];
  if (obj && typeof obj === "object") return Object.entries(obj).flatMap(([k, v]) => leaves(v, [...path, k]));
  return [];
}

describe("copy dictionary", () => {
  it("has no empty strings, em dashes, emojis, semicolons or exclamation marks", () => {
    for (const [key, value] of leaves(en)) {
      expect(value.trim(), key).not.toBe("");
      expect(EM_DASH.test(value), `${key} contains an em dash`).toBe(false);
      expect(EMOJI.test(value), `${key} contains an emoji`).toBe(false);
      expect(proseFlaws(value), `${key} contains punctuation the house style leaves out`).toEqual([]);
    }
  });

  it("every locale has exactly the same keys", () => {
    const reference = leaves(en).map(([k]) => k).sort();
    for (const [name, dict] of Object.entries(locales)) {
      expect(leaves(dict).map(([k]) => k).sort(), name).toEqual(reference);
    }
  });
});

describe("the prose check", () => {
  it("catches semicolons and exclamation marks in sentences", () => {
    expect(proseFlaws("Ringed files have findings; select one.")).toEqual(["a semicolon"]);
    expect(proseFlaws("Done!")).toEqual(["an exclamation mark"]);
    expect(proseFlaws("; ")).toEqual(["a semicolon"]);
  });

  it("lets code-shaped text through", () => {
    expect(proseFlaws("btn max-[900px]:hidden! max-[900px]:[--s:6px]!")).toEqual([]);
    expect(proseFlaws("if [ -f a ]; then npm ci; fi")).toEqual([]);
    expect(proseFlaws("Text between &laquo; and &raquo;")).toEqual([]);
    expect(proseFlaws(";")).toEqual([]);
    expect(proseFlaws("a !== b")).toEqual([]);
  });
});

/** Walks the web app, worker and package sources so inline copy follows the same rules. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === "dist") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(tsx?|md)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Every string literal, template piece and JSX text in a source file, with its line. */
function stringsIn(file: string, text: string): Array<[number, string]> {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: Array<[number, string]> = [];
  const visit = (node: ts.Node): void => {
    let value: string | null = null;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) value = node.text;
    else if (node.kind === ts.SyntaxKind.JsxText) value = node.getText(source);
    if (value !== null) out.push([source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, value]);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

describe("inline UI copy", () => {
  const root = join(import.meta.dirname, "..", "..", "..", "..");
  const dirs = [
    join(root, "apps", "web", "src"),
    join(root, "apps", "worker", "src"),
    join(root, "packages", "cli", "src"),
    join(root, "packages", "engine", "src"),
    join(root, "packages", "shared", "src"),
  ].filter((d) => {
    try {
      return statSync(d).isDirectory();
    } catch {
      return false;
    }
  });

  it("uses no em dashes or emojis in source files", () => {
    const offenders: string[] = [];
    for (const dir of dirs) {
      for (const file of sourceFiles(dir)) {
        if (file.endsWith("copy.test.ts")) continue;
        const lines = readFileSync(file, "utf8").split("\n");
        lines.forEach((line, i) => {
          if (EM_DASH.test(line) || EMOJI.test(line)) offenders.push(`${file.replace(root + "/", "")}:${i + 1}`);
        });
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("uses no semicolons or exclamation marks in source strings", () => {
    const offenders: string[] = [];
    for (const dir of dirs) {
      for (const file of sourceFiles(dir)) {
        if (!/\.tsx?$/.test(file)) continue;
        for (const [line, value] of stringsIn(file, readFileSync(file, "utf8"))) {
          const flaws = proseFlaws(value);
          if (flaws.length) offenders.push(`${file.replace(root + "/", "")}:${line} has ${flaws.join(" and ")}: ${value.replace(/\s+/g, " ").slice(0, 80)}`);
        }
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
