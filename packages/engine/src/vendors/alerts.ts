import type { Alert, Runway, StageId, StageState, Vendor, VendorKnowledge, Watch } from "@birdsi/shared";
import { STAGE_FRESH_HOURS, STAGE_LABEL, bestFacts } from "@birdsi/shared";

export interface Observation {
  metric: string;
  numeric: number;
  limit_numeric: number | null;
  observed_at: string;
}

/**
 * Alerts are computed from facts every time they are read, never stored, so
 * they can never go stale. An alert is about something true now: a limit at
 * 80% warns, at 95% is critical, a paused project is critical. Conditions
 * that might happen (a free plan that pauses, a trial that ends) are
 * watches, not alerts, until the evidence says they are happening.
 */
export function computeAlerts(vendors: Vendor[], _knowledge: Map<string, VendorKnowledge>, connectionErrors: Map<string, string>, runways: Map<string, Runway[]> = new Map()): Alert[] {
  const alerts: Alert[] = [];
  for (const v of vendors) {
    const error = connectionErrors.get(v.slug);
    if (error) {
      alerts.push({ id: `${v.id}:connection`, vendorId: v.id, vendorName: v.name, level: "warning", title: `${v.name} could not be read`, detail: error, suggestedCommand: null, runsOutAt: null });
    }
    // One fact per metric: the account outranks the owner, who outranks an agent, the docs, the code.
    const facts = bestFacts(v.facts);
    const paused = facts.find((f) => f.metric === "paused_projects" && (f.numeric ?? 0) > 0);
    if (paused) {
      alerts.push({ id: `${v.id}:paused`, vendorId: v.id, vendorName: v.name, level: "critical", title: `${v.name}: ${paused.numeric === 1 ? "a project is" : `${paused.numeric} projects are`} paused`, detail: `${paused.value}. The app cannot reach a paused project. Restore it in the ${v.name} dashboard, or move to a plan that does not pause.`, suggestedCommand: upgradeCommand(v), runsOutAt: null });
    }
    const usage = facts.filter((f) => f.kind === "usage" && f.numeric !== null && f.limitNumeric !== null && f.limitNumeric > 0);
    const vendorRunways = runways.get(v.id) ?? [];
    for (const f of usage) {
      const remainingMetric = /remaining/i.test(f.metric);
      const ratio = remainingMetric ? 1 - f.numeric! / f.limitNumeric! : f.numeric! / f.limitNumeric!;
      const runway = vendorRunways.find((r) => r.metric === f.metric);
      const runsOut = runway?.runsOutAt ?? null;
      const when = runsOut ? ` At the current rate it runs out around ${new Date(runsOut).toLocaleDateString("en-US", { month: "long", day: "numeric" })}.` : "";
      if (ratio >= 0.95) {
        alerts.push({ id: `${v.id}:${f.metric}`, vendorId: v.id, vendorName: v.name, level: "critical", title: `${v.name}: ${f.label.toLowerCase()} at ${Math.round(ratio * 100)}% of the limit`, detail: `${f.value}${f.unit ? ` ${f.unit}` : ""}. The app may start failing when the limit is reached.${when}`, suggestedCommand: upgradeCommand(v), runsOutAt: runsOut });
      } else if (ratio >= 0.8) {
        alerts.push({ id: `${v.id}:${f.metric}`, vendorId: v.id, vendorName: v.name, level: "warning", title: `${v.name}: ${f.label.toLowerCase()} at ${Math.round(ratio * 100)}% of the limit`, detail: `${f.value}${f.unit ? ` ${f.unit}` : ""}. Worth planning the next tier before it runs out.${when}`, suggestedCommand: upgradeCommand(v), runsOutAt: runsOut });
      } else if (runway && runway.daysLeft !== null && runway.daysLeft <= 7) {
        // Not near the limit yet, but the rate says it will be within a week.
        alerts.push({ id: `${v.id}:${f.metric}:rate`, vendorId: v.id, vendorName: v.name, level: "warning", title: `${v.name}: ${f.label.toLowerCase()} runs out in about ${Math.max(1, Math.round(runway.daysLeft))} days at the current rate`, detail: `${f.value}${f.unit ? ` ${f.unit}` : ""} now, about ${Math.round(runway.perDay)} a day over the last ${runway.observations} readings.`, suggestedCommand: upgradeCommand(v), runsOutAt: runsOut });
      }
    }
    // Unknown plans and unconnected accounts are not alerts: the vendor card says
    // "connect" and the question queue asks for the plan. Alerts stay for what is true now.
  }
  const order: Record<Alert["level"], number> = { critical: 0, warning: 1, info: 2 };
  return alerts.sort((a, b) => order[a.level] - order[b.level] || a.title.localeCompare(b.title));
}

const CONDITION = /(pause|paused|inactiv|sleep|trial|expire|suspend|archiv|idle|spin.?down|cold start|after \d+ days)/i;

/**
 * Conditions to track per vendor, from the plan's own terms. A watch never
 * warns; it tells the owner what the plan does and what birdsI would need to
 * see to know it is happening.
 */
export function computeWatches(vendors: Vendor[], knowledge: Map<string, VendorKnowledge>): Watch[] {
  const watches: Watch[] = [];
  for (const v of vendors) {
    const plan = v.facts.find((f) => f.kind === "plan");
    const k = knowledge.get(v.slug);
    const tier = plan && k ? k.tiers.find((t) => t.name.toLowerCase() === plan.value.toLowerCase() || plan.value.toLowerCase().includes(t.name.toLowerCase())) : null;
    const seen = new Set<string>();
    const add = (title: string, detail: string, needs: string | null, dueAt: string | null = null) => {
      const id = `${v.id}:${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
      if (seen.has(id)) return;
      seen.add(id);
      watches.push({ id, vendorId: v.id, vendorName: v.name, title, detail, dueAt, needs });
    };
    if (tier) {
      for (const l of tier.limits) {
        const text = `${l.label} ${l.note ?? ""}`;
        if (CONDITION.test(text)) add(`${tier.name} plan: ${l.label.toLowerCase()}`, l.note ?? l.label, v.connected ? null : `Connect ${v.name} so birdsI can see whether this is happening.`);
      }
      if (tier.priceNote && CONDITION.test(tier.priceNote)) add(`${tier.name} plan terms`, tier.priceNote, null);
    }
    if (plan && /trial/i.test(plan.value)) {
      const ends = v.facts.find((f) => /trial_end|ends_at|expires/i.test(f.metric));
      add("Trial", ends ? `The trial ends ${ends.value}.` : "The account is on a trial. birdsI does not know when it ends.", ends ? null : "The trial end date, from the account or from you.", ends?.value && !Number.isNaN(Date.parse(ends.value)) ? new Date(ends.value).toISOString() : null);
    }
    if (v.slug === "supabase" && plan && /free/i.test(plan.value)) {
      const pausedFact = v.facts.find((f) => f.metric === "paused_projects");
      add("Free plan: projects pause after a week without traffic", pausedFact ? `Last check: ${pausedFact.numeric === 0 ? "nothing paused" : pausedFact.value}.` : "Supabase pauses free projects after about seven days with no requests. Live traffic keeps it awake.", pausedFact ? null : "Connect Supabase so birdsI can see whether a project is paused.");
    }
  }
  return watches;
}

/** Days until a counted limit runs out at the rate seen between the first and last observation. */
export function computeRunway(observations: Observation[], labels: Map<string, string>): Runway[] {
  const byMetric = new Map<string, Observation[]>();
  for (const o of observations) byMetric.set(o.metric, [...(byMetric.get(o.metric) ?? []), o]);
  const out: Runway[] = [];
  for (const [metric, list] of byMetric) {
    if (list.length < 2) continue;
    const sorted = list.slice().sort((a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at));
    const first = sorted[0]!;
    const last = sorted[sorted.length - 1]!;
    const hours = (Date.parse(last.observed_at) - Date.parse(first.observed_at)) / 3_600_000;
    if (hours < 1) continue;
    const remainingMetric = /remaining/i.test(metric);
    const delta = remainingMetric ? first.numeric - last.numeric : last.numeric - first.numeric;
    const perDay = (delta / hours) * 24;
    const limit = last.limit_numeric;
    let daysLeft: number | null = null;
    let runsOutAt: string | null = null;
    if (perDay > 0 && limit !== null) {
      const left = remainingMetric ? last.numeric : limit - last.numeric;
      daysLeft = left / perDay;
      runsOutAt = new Date(Date.parse(last.observed_at) + daysLeft * 86_400_000).toISOString();
    }
    out.push({ metric, label: labels.get(metric) ?? metric, perDay: Math.round(perDay * 100) / 100, runsOutAt, daysLeft: daysLeft === null ? null : Math.round(daysLeft * 10) / 10, observations: sorted.length });
  }
  return out;
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
