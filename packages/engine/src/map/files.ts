import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { SourceLine } from "@birdsi/shared";
import { maskSecrets } from "../checks/secrets";
import type { Inventory } from "../inventory/walk";

/** Files the map reads, at most this size each (the inventory keeps nothing larger). */
export const MAX_BYTES = 2 * 1024 * 1024;

/** Generated or minified text: one line that runs on for thousands of characters, or almost no line breaks at all. */
export function isMinified(content: string): boolean {
  if (content.length < 20_000) return false;
  const lines = content.split("\n");
  const longest = lines.reduce((max, l) => Math.max(max, l.length), 0);
  return longest > 5_000 || content.length / lines.length > 400;
}

/** Reads files from one snapshot once each, and turns a match into a masked source line. */
export class MapFiles {
  readonly paths: Set<string>;
  private readonly cache = new Map<string, string | null>();

  constructor(readonly inventory: Inventory) {
    this.paths = new Set(inventory.files.map((f) => f.path));
  }

  has(path: string): boolean {
    return this.paths.has(path);
  }

  async text(path: string): Promise<string | null> {
    if (this.cache.has(path)) return this.cache.get(path) ?? null;
    const file = this.inventory.files.find((f) => f.path === path);
    let content: string | null = null;
    if (file && file.bytes <= MAX_BYTES) {
      try {
        content = await readFile(join(this.inventory.root, path), "utf8");
        if (isMinified(content)) content = null;
      } catch {
        content = null;
      }
    }
    this.cache.set(path, content);
    return content;
  }

  /** Code files, test files left out. */
  code(): string[] {
    return this.inventory.files.filter((f) => f.bytes <= MAX_BYTES && /\.(tsx?|jsx?|mjs|cjs|mts|cts)$/.test(f.path) && !isTestPath(f.path)).map((f) => f.path);
  }
}

export function isTestPath(path: string): boolean {
  return /(^|\/)(__tests__|__mocks__|tests?|e2e|fixtures?)\//.test(path) || /\.(test|spec|stories)\.[a-z]+$/.test(path);
}

/** The line a character offset falls on, 1-based. */
export function lineAt(content: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < content.length; i++) if (content.charCodeAt(i) === 10) line += 1;
  return line;
}

export function sourceLine(path: string, content: string, line: number): SourceLine {
  const text = content.split("\n")[line - 1] ?? "";
  return { path, line, text: maskSecrets(text.trim()).slice(0, 200) };
}

export function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

export function joinPath(dir: string, rel: string): string {
  const parts = (dir ? dir.split("/") : []).concat(rel.split("/"));
  const out: string[] = [];
  for (const p of parts) {
    if (p === "" || p === ".") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return out.join("/");
}
