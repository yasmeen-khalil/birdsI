import type { Alert, Runway, StageId, StageState, Vendor, Watch } from "@birdsi/shared";
import { LIMITS_BY_SLUG, STAGE_FRESH_HOURS, STAGE_LABEL, bestFacts, checkedLimit, tierFor } from "@birdsi/shared";

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
export function computeAlerts(vendors: Vendor[], connectionErrors: Map<string, string>, runways: Map<string, Runway[]> = new Map()): Alert[] {
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
    // A usage number counts against the limit the account reported, or else the checked limit of the plan it is on.
    const plan = facts.find((f) => f.kind === "plan")?.value ?? null;
    const usage = facts
      .filter((f) => f.kind === "usage" && f.numeric !== null)
      .map((f) => (f.limitNumeric !== null ? f : { ...f, limitNumeric: checkedLimit(v.slug, plan, f.metric)?.amount ?? null }))
      .filter((f) => f.limitNumeric !== null && f.limitNumeric > 0);
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

/**
 * Conditions to track per vendor, from birdsI's checked limits list: what the
 * plan the account is on does on its own (a free project that pauses, a plan
 * that is for personal use only). A watch never warns; it says what the plan
 * does and what birdsI would need to see to know it is happening.
 */
export function computeWatches(vendors: Vendor[]): Watch[] {
  const watches: Watch[] = [];
  for (const v of vendors) {
    const limits = LIMITS_BY_SLUG.get(v.slug);
    if (!limits) continue;
    const plan = bestFacts(v.facts).find((f) => f.kind === "plan");
    const tier = plan ? tierFor(limits, plan.value) : null;
    if (!tier) continue;
    for (const condition of tier.conditions) {
      const id = `${v.id}:${condition.id}`;
      const paused = condition.id === "pauses" ? v.facts.find((f) => f.metric === "paused_projects") : undefined;
      watches.push({
        id,
        vendorId: v.id,
        vendorName: v.name,
        title: `${tier.name} plan: ${condition.text}`,
        detail: paused ? `Last read: ${paused.numeric === 0 ? "nothing paused" : paused.value}.` : condition.text,
        dueAt: null,
        needs: v.connected ? null : `Connect ${v.name} so birdsI can see whether this is happening.`,
      });
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

/**
 * Monthly spend read from the accounts, and only that. A plan's list price is
 * not money spent, so it is never added in (birdsI did that before v3).
 */
export function monthlySpend(vendors: Vendor[]): { totalUsd: number; vendors: string[] } | null {
  let total = 0;
  const read: string[] = [];
  for (const v of vendors) {
    const spend = bestFacts(v.facts).find((f) => f.kind === "cost" && f.metric === "spend_month" && f.numeric !== null && f.source === "connector");
    if (!spend) continue;
    total += spend.numeric!;
    read.push(v.name);
  }
  return read.length > 0 ? { totalUsd: Math.round(total * 100) / 100, vendors: read } : null;
}

export function stageStates(input: { lastMapAt: string | null; mapRunning: boolean; lastReadAt: string | null; readRunning: boolean }): StageState[] {
  const state = (id: StageId, at: string | null, running: boolean, detail: string): StageState => {
    let freshness: StageState["freshness"] = "never";
    if (running) freshness = "running";
    else if (at) freshness = Date.now() - new Date(at).getTime() < STAGE_FRESH_HOURS[id] * 3_600_000 ? "fresh" : "stale";
    return { id, label: STAGE_LABEL[id], lastRunAt: at, freshness, detail };
  };
  return [
    state("map", input.lastMapAt, input.mapRunning, "Every file, package, service, deployment, cron, webhook and migration, read from the code without a model."),
    state("reads", input.lastReadAt, input.readRunning, "Status, plan and usage read from each connected account, every hour."),
  ];
}
