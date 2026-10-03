import type { Alert, StageId, StageState, Vendor, VendorKnowledge } from "@birdsi/shared";
import { STAGE_FRESH_HOURS, STAGE_LABEL } from "@birdsi/shared";

/**
 * Alerts are computed from facts every time they are read, never stored, so
 * they can never go stale. Thresholds: 80% of a limit warns, 95% is critical.
 */
export function computeAlerts(vendors: Vendor[], knowledge: Map<string, VendorKnowledge>, connectionErrors: Map<string, string>): Alert[] {
  const alerts: Alert[] = [];
  for (const v of vendors) {
    const error = connectionErrors.get(v.slug);
    if (error) {
      alerts.push({ id: `${v.id}:connection`, vendorId: v.id, vendorName: v.name, level: "warning", title: `${v.name} could not be read`, detail: error, suggestedCommand: null });
    }
    const usage = v.facts.filter((f) => f.kind === "usage" && f.numeric !== null && f.limitNumeric !== null && f.limitNumeric > 0);
    for (const f of usage) {
      const remainingMetric = /remaining/i.test(f.metric);
      const ratio = remainingMetric ? 1 - f.numeric! / f.limitNumeric! : f.numeric! / f.limitNumeric!;
      if (ratio >= 0.95) {
        alerts.push({ id: `${v.id}:${f.metric}`, vendorId: v.id, vendorName: v.name, level: "critical", title: `${v.name}: ${f.label.toLowerCase()} at ${Math.round(ratio * 100)}% of the limit`, detail: `${f.value}${f.unit ? ` ${f.unit}` : ""}. The app may start failing when the limit is reached.`, suggestedCommand: upgradeCommand(v) });
      } else if (ratio >= 0.8) {
        alerts.push({ id: `${v.id}:${f.metric}`, vendorId: v.id, vendorName: v.name, level: "warning", title: `${v.name}: ${f.label.toLowerCase()} at ${Math.round(ratio * 100)}% of the limit`, detail: `${f.value}${f.unit ? ` ${f.unit}` : ""}. Worth planning the next tier before it runs out.`, suggestedCommand: upgradeCommand(v) });
      }
    }
    const hasPlan = v.facts.some((f) => f.kind === "plan");
    const k = knowledge.get(v.slug);
    if (!hasPlan && k && k.tiers.length > 0) {
      alerts.push({ id: `${v.id}:plan`, vendorId: v.id, vendorName: v.name, level: "info", title: `${v.name}: plan unknown`, detail: v.connectable && !v.connected ? "Connect the account, or answer the question in the queue, so birdsI can watch its limits." : "Answer the question in the queue so birdsI can watch its limits.", suggestedCommand: null });
    }
    if (v.connectable && !v.connected && hasPlan === false) {
      alerts.push({ id: `${v.id}:connect`, vendorId: v.id, vendorName: v.name, level: "info", title: `Connect ${v.name}`, detail: "With a read-only token birdsI reads the plan, usage and spend itself.", suggestedCommand: null });
    }
  }
  const order: Record<Alert["level"], number> = { critical: 0, warning: 1, info: 2 };
  return alerts.sort((a, b) => order[a.level] - order[b.level] || a.title.localeCompare(b.title));
}

/** Projects set up through Stripe Projects can be upgraded from the terminal. */
function upgradeCommand(v: Vendor): string | null {
  return v.detectedBy.includes("projects") ? `stripe projects upgrade ${v.slug}` : null;
}

/** Monthly spend across vendors where a plan price or a spend fact is known. */
export function monthlySpend(vendors: Vendor[], knowledge: Map<string, VendorKnowledge>): number | null {
  let total = 0;
  let any = false;
  for (const v of vendors) {
    const spend = v.facts.find((f) => f.kind === "cost" && f.metric === "spend_month" && f.numeric !== null);
    if (spend) {
      total += spend.numeric!;
      any = true;
      continue;
    }
    const plan = v.facts.find((f) => f.kind === "plan");
    const k = knowledge.get(v.slug);
    if (plan && k) {
      const tier = k.tiers.find((t) => t.name.toLowerCase() === plan.value.toLowerCase());
      if (tier && tier.priceUsd !== null) {
        total += tier.priceUsd;
        any = true;
      }
    }
  }
  return any ? Math.round(total * 100) / 100 : null;
}

export function stageStates(input: { lastScanAt: string | null; lastScanRunning: boolean; lastDocsAt: string | null; lastAuditAt: string | null; lastOpsAt: string | null; opsRunning: boolean }): StageState[] {
  const state = (id: StageId, at: string | null, running: boolean, detail: string): StageState => {
    let freshness: StageState["freshness"] = "never";
    if (running) freshness = "running";
    else if (at) freshness = Date.now() - new Date(at).getTime() < STAGE_FRESH_HOURS[id] * 3_600_000 ? "fresh" : "stale";
    return { id, label: STAGE_LABEL[id], lastRunAt: at, freshness, detail };
  };
  return [
    state("inventory", input.lastScanAt, input.lastScanRunning, "Every file, dependency and vendor, mapped from the code."),
    state("docs", input.lastDocsAt, input.lastScanRunning, "Dependencies checked against their current documentation."),
    state("audit", input.lastAuditAt, input.lastScanRunning, "The code read for security holes, gaps and contradictions."),
    state("ops", input.lastOpsAt, input.opsRunning, "Plans, usage and limits read from connected accounts and current pricing pages."),
  ];
}
