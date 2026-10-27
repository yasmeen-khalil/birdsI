import { maskSecrets } from "../checks/secrets";

/** One file, or one stretch of a large file, with its lines numbered so the model can cite them. */
export interface Segment {
  path: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  /** Masked and numbered: "12| const x = 1". */
  text: string;
  chars: number;
}

export interface Batch {
  segments: Segment[];
  chars: number;
}

/** A stretch of one file sent in one piece, in characters of numbered text. */
export const MAX_SEGMENT_CHARS = 150_000;
/** Files sent to the model in one call, in characters of numbered text. */
export const MAX_BATCH_CHARS = 180_000;
/** Characters per token, the rough rate the budget is counted at. */
export const CHARS_PER_TOKEN = 3.6;

/** Splits a file into stretches that fit a call, every line numbered from its place in the file. */
export function segmentsOf(path: string, content: string): Segment[] {
  const lines = maskSecrets(content).split("\n");
  const total = lines.length;
  const out: Segment[] = [];
  let start = 0;
  while (start < total) {
    let chars = 0;
    let end = start;
    while (end < total && (end === start || chars + lines[end]!.length + 8 <= MAX_SEGMENT_CHARS)) {
      chars += lines[end]!.length + 8;
      end += 1;
    }
    const text = lines.slice(start, end).map((l, i) => `${start + i + 1}| ${l}`).join("\n");
    out.push({ path, startLine: start + 1, endLine: end, totalLines: total, text, chars: text.length });
    start = end;
  }
  return out;
}

/** Groups segments into calls, in the order given, each under the batch size. */
export function batchSegments(segments: Segment[]): Batch[] {
  const batches: Batch[] = [];
  let current: Batch = { segments: [], chars: 0 };
  for (const s of segments) {
    if (current.segments.length > 0 && current.chars + s.chars > MAX_BATCH_CHARS) {
      batches.push(current);
      current = { segments: [], chars: 0 };
    }
    current.segments.push(s);
    current.chars += s.chars;
  }
  if (current.segments.length > 0) batches.push(current);
  return batches;
}

/** The text of one call: each stretch under a heading that names the file and the lines shown. */
export function batchText(batch: Batch): string {
  return batch.segments.map((s) => `### ${s.path} (lines ${s.startLine} to ${s.endLine} of ${s.totalLines})\n${s.text}`).join("\n\n");
}

export function tokensOf(chars: number): number {
  return Math.ceil(chars / CHARS_PER_TOKEN);
}
