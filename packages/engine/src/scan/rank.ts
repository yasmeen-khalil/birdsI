import { CONFIDENCE_ORDER, SEVERITY_ORDER, type Confidence, type FindingDraft, type ScanSummary, type Severity } from "@birdsi/shared";

/**
 * Orders and de-duplicates findings and writes the summary. Deterministic,
 * so two runs over the same findings agree.
 */
export function rankFindings(findings: FindingDraft[]): FindingDraft[] {
  const byKey = new Map<string, FindingDraft>();
  for (const f of findings) {
    const existing = byKey.get(f.key);
    if (!existing || rankOf(f) < rankOf(existing)) byKey.set(f.key, f);
  }
  // Model findings that restate a proven finding at the same location are folded in.
  const proven = [...byKey.values()].filter((f) => f.confidence === "proven");
  const result = [...byKey.values()].filter((f) => {
    if (f.confidence === "proven") return true;
    return !proven.some((p) => p.location?.path === f.location?.path && p.checkId !== f.checkId && similar(p.title, f.title));
  });
  return result.sort((a, b) => rankOf(a) - rankOf(b) || a.title.localeCompare(b.title));
}

function rankOf(f: FindingDraft): number {
  return SEVERITY_ORDER.indexOf(f.severity) * 10 + CONFIDENCE_ORDER.indexOf(f.confidence);
}

function similar(a: string, b: string): boolean {
  const wa = new Set(tokens(a));
  const wb = new Set(tokens(b));
  if (wa.size === 0 || wb.size === 0) return false;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared += 1;
  return shared / Math.min(wa.size, wb.size) >= 0.6;
}

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3);
}

export function summarise(findings: FindingDraft[], ids: string[]): ScanSummary {
  const bySeverity = Object.fromEntries(SEVERITY_ORDER.map((s) => [s, 0])) as Record<Severity, number>;
  const byConfidence = Object.fromEntries(CONFIDENCE_ORDER.map((c) => [c, 0])) as Record<Confidence, number>;
  let fixable = 0;
  let needsYou = 0;
  findings.forEach((f) => {
    bySeverity[f.severity] += 1;
    byConfidence[f.confidence] += 1;
    if (f.actionKind === "fix") fixable += 1;
    else needsYou += 1;
  });
  const startWith = findings
    .map((f, i) => ({ f, id: ids[i]! }))
    .filter((x) => x.f.severity === "critical" || x.f.severity === "high")
    .slice(0, 3)
    .map((x) => x.id);
  return { headline: headline(findings.length, bySeverity), bySeverity, byConfidence, fixable, needsYou, startWith };
}

function headline(total: number, bySeverity: Record<Severity, number>): string {
  if (total === 0) return "Nothing found. The checks that ran came back clean.";
  const parts: string[] = [];
  if (bySeverity.critical > 0) parts.push(`${bySeverity.critical} critical`);
  if (bySeverity.high > 0) parts.push(`${bySeverity.high} high`);
  const rest = bySeverity.medium + bySeverity.low;
  if (rest > 0) parts.push(`${rest} lower`);
  const lead = bySeverity.critical > 0 ? "Fix the critical findings first." : bySeverity.high > 0 ? "Start with the high findings." : "Nothing urgent; work through these when convenient.";
  return `${total} finding${total === 1 ? "" : "s"}: ${parts.join(", ")}. ${lead}`;
}
