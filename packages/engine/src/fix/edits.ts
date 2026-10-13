import { z } from "zod";

/**
 * A fix is a list of file edits. Search-and-replace blocks are used instead
 * of unified diffs because models produce them far more reliably, and each
 * block is verified against the real file before anything is written.
 */
export const FileEdit = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("replace"),
    path: z.string(),
    /** Exact text to find; must occur exactly once. */
    search: z.string().min(1),
    replace: z.string(),
  }),
  z.object({
    op: z.literal("create"),
    path: z.string(),
    content: z.string(),
  }),
  z.object({
    op: z.literal("delete"),
    path: z.string(),
  }),
]);
export type FileEdit = z.infer<typeof FileEdit>;

export interface AppliedFile {
  path: string;
  /** null means the file is deleted. */
  content: string | null;
  before: string | null;
}

export class EditError extends Error {
  override name = "EditError";
}

/**
 * Applies edits in memory. `readFile` returns null for a missing file.
 * Returns the final content of every touched file, ready for a commit.
 */
export async function applyEdits(edits: FileEdit[], readFile: (path: string) => Promise<string | null>): Promise<AppliedFile[]> {
  const state = new Map<string, { content: string | null; before: string | null }>();
  const load = async (path: string) => {
    if (!state.has(path)) {
      const content = await readFile(path);
      state.set(path, { content, before: content });
    }
    return state.get(path)!;
  };
  for (const edit of edits) {
    if (edit.path.includes("..") || edit.path.startsWith("/")) throw new EditError(`Refusing to edit a path outside the repository: ${edit.path}`);
    const entry = await load(edit.path);
    if (edit.op === "create") {
      if (entry.content !== null) throw new EditError(`${edit.path} already exists. Use a replace edit.`);
      entry.content = edit.content;
    } else if (edit.op === "delete") {
      if (entry.content === null) throw new EditError(`${edit.path} does not exist`);
      entry.content = null;
    } else {
      if (entry.content === null) throw new EditError(`${edit.path} does not exist`);
      const occurrences = countOccurrences(entry.content, edit.search);
      if (occurrences === 0) {
        const relaxed = relaxedFind(entry.content, edit.search);
        if (!relaxed) throw new EditError(`The text to replace was not found in ${edit.path}`);
        entry.content = entry.content.slice(0, relaxed.start) + edit.replace + entry.content.slice(relaxed.end);
        continue;
      }
      if (occurrences > 1) throw new EditError(`The text to replace occurs ${occurrences} times in ${edit.path}. It must be unique.`);
      entry.content = entry.content.replace(edit.search, () => edit.replace);
    }
  }
  return [...state.entries()].filter(([, v]) => v.content !== v.before).map(([path, v]) => ({ path, content: v.content, before: v.before }));
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count += 1;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

/** Tolerates trailing whitespace and indentation differences line by line. */
function relaxedFind(content: string, search: string): { start: number; end: number } | null {
  const lines = content.split("\n");
  const target = search.split("\n").map((l) => l.trim());
  if (target.length === 0) return null;
  for (let i = 0; i + target.length <= lines.length; i++) {
    let ok = true;
    for (let j = 0; j < target.length; j++) {
      if (lines[i + j]!.trim() !== target[j]) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    const start = lines.slice(0, i).reduce((n, l) => n + l.length + 1, 0);
    const end = start + lines.slice(i, i + target.length).reduce((n, l) => n + l.length + 1, 0) - 1;
    return { start, end };
  }
  return null;
}

/** A unified diff for display and for applying locally with `git apply`. */
export function toUnifiedDiff(files: AppliedFile[]): string {
  const out: string[] = [];
  for (const file of files) {
    const before = file.before ?? "";
    const after = file.content ?? "";
    const a = file.before === null ? "/dev/null" : `a/${file.path}`;
    const b = file.content === null ? "/dev/null" : `b/${file.path}`;
    out.push(`diff --git a/${file.path} b/${file.path}`);
    if (file.before === null) out.push("new file mode 100644");
    if (file.content === null) out.push("deleted file mode 100644");
    out.push(`--- ${a}`, `+++ ${b}`);
    out.push(...hunks(splitLines(before), splitLines(after), before, after));
  }
  return out.join("\n") + "\n";
}

/** Lines without the phantom empty entry a trailing newline would add. */
function splitLines(content: string): string[] {
  if (content === "") return [];
  const lines = content.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

const NO_NEWLINE = "\\ No newline at end of file";

/** Minimal line diff (LCS) good enough for the small edits a fix makes. */
function hunks(a: string[], b: string[], beforeText: string, afterText: string): string[] {
  const aNoNl = beforeText !== "" && !beforeText.endsWith("\n");
  const bNoNl = afterText !== "" && !afterText.endsWith("\n");
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const ops: Array<{ t: " " | "-" | "+"; line: string }> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ t: " ", line: a[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      ops.push({ t: "-", line: a[i]! });
      i++;
    } else {
      ops.push({ t: "+", line: b[j]! });
      j++;
    }
  }
  while (i < n) ops.push({ t: "-", line: a[i++]! });
  while (j < m) ops.push({ t: "+", line: b[j++]! });
  if (ops.length === 0) return [];
  // One hunk with 3 lines of context around changes, merged when close.
  const out: string[] = [];
  const context = 3;
  let k = 0;
  while (k < ops.length) {
    if (ops[k]!.t === " ") {
      k++;
      continue;
    }
    let start = Math.max(0, k - context);
    let end = k;
    while (end < ops.length) {
      if (ops[end]!.t !== " ") {
        end++;
        continue;
      }
      let run = 0;
      while (end + run < ops.length && ops[end + run]!.t === " ") run++;
      if (end + run >= ops.length || run > context * 2) {
        end = Math.min(ops.length, end + context);
        break;
      }
      end += run;
    }
    const slice = ops.slice(start, end);
    let oldStart = 1;
    let newStart = 1;
    for (let q = 0; q < start; q++) {
      if (ops[q]!.t !== "+") oldStart++;
      if (ops[q]!.t !== "-") newStart++;
    }
    const oldLen = slice.filter((o) => o.t !== "+").length;
    const newLen = slice.filter((o) => o.t !== "-").length;
    out.push(`@@ -${oldStart},${oldLen} +${newStart},${newLen} @@`);
    for (let q = 0; q < slice.length; q++) {
      const o = slice[q]!;
      out.push(`${o.t}${o.line}`);
      // Git needs to know when the last line of either side has no newline.
      const isLastOld = o.t !== "+" && oldStart + slice.slice(0, q + 1).filter((x) => x.t !== "+").length - 1 === n;
      const isLastNew = o.t !== "-" && newStart + slice.slice(0, q + 1).filter((x) => x.t !== "-").length - 1 === m;
      if ((isLastOld && aNoNl && o.t !== " ") || (isLastNew && bNoNl && o.t !== " ") || (o.t === " " && isLastOld && aNoNl && bNoNl)) out.push(NO_NEWLINE);
    }
    k = end;
    start = end;
  }
  return out;
}
