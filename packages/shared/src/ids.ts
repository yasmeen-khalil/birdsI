/**
 * Stable finding keys. Two scans of the same repo produce the same key for
 * the same problem, so status (fixed, dismissed) carries across scans.
 */
export function findingKey(parts: {
  checkId: string;
  path?: string | null;
  subject: string;
}): string {
  const raw = [parts.checkId, parts.path ?? "", parts.subject.trim().toLowerCase()].join("\u0000");
  return `${parts.checkId}:${fnv1a64(raw)}`;
}

/** 64-bit FNV-1a as hex. Fast, dependency-free, and stable across runtimes. */
export function fnv1a64(input: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const bytes = new TextEncoder().encode(input);
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}
