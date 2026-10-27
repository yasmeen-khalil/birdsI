import type { AlertsResponse, AppAlert, ChecklistView, CockpitView } from "@birdsi/shared";

/**
 * The cockpit as lines of text, shared by `birdsi cockpit` and the
 * birdsi_cockpit MCP tool. The tool passes a quote function that marks text
 * read from the code or a vendor as data.
 */

type Quote = (s: string) => string;
const plain: Quote = (s) => s;

function n(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;
}

function notRead(reason: string): string {
  return `not read: ${reason.replace(/^Not read(:|,)?\s*/i, "")}`;
}

export function alertLine(a: AppAlert, q: Quote = plain): string {
  return `- [${a.severity}] ${q(a.sentence)}${a.action && !a.resolvedAt ? ` ${q(a.action)}` : ""}${a.resolvedAt ? ` (closed ${a.resolvedAt.slice(0, 10)})` : ""}`;
}

/** The checklist as lines of text, shared by `birdsi setup` and the birdsi_setup MCP tool. */
export function setupLines(v: ChecklistView, q: Quote = plain): string[] {
  const lines: string[] = [`${q(v.appName)}: ${v.required.done} of ${v.required.total} required steps done${v.complete ? ", the cockpit is complete" : ""}, ${v.optional.done} of ${v.optional.total} optional.`, ""];
  let group = "";
  for (const item of v.items) {
    if (item.group !== group) {
      group = item.group;
      lines.push(group);
    }
    const mark = item.status === "done" ? "done" : item.status === "failed" ? "NOT WORKING" : item.status === "blocked" ? "waiting" : item.required ? "to do" : "optional";
    lines.push(`- [${mark}] ${item.title}: ${q(item.state)}`);
    if (item.status !== "done") {
      for (const s of item.steps) lines.push(`    ${s}`);
      if (item.willDo) lines.push(`    Once done: ${item.willDo}`);
      for (const l of item.links) lines.push(`    ${l.label}: ${l.url}`);
    }
  }
  lines.push("", v.mayDo);
  return lines;
}

export function cockpitLines(v: CockpitView, q: Quote = plain): string[] {
  const lines: string[] = [];
  const map = v.map;
  lines.push(`${q(v.appName)}${map ? `, mapped ${map.mappedAt.slice(0, 16).replace("T", " ")} UTC${map.commit ? ` at ${map.commit.slice(0, 7)}` : ""}` : ""}${v.lastReadAt ? `, last read ${v.lastReadAt.slice(0, 16).replace("T", " ")} UTC` : ""}`);
  if (!map) lines.push(`No service map: ${q(v.mapReason ?? "map the code first")}`);
  lines.push("");

  lines.push(v.alerts.open.length === 0 ? "Alerts: none open." : `Alerts (${v.alerts.open.length} open, ${v.alerts.critical} critical):`);
  if (v.alerts.reason) lines.push(`  ${q(v.alerts.reason)}`);
  for (const a of v.alerts.open.slice(0, 12)) lines.push(alertLine(a, q));
  lines.push(`  ${v.alerts.email.sentence}`, "");

  if (v.undeclared.length > 0) lines.push(`The code uses ${v.undeclared.map((u) => u.name).join(", ")} with no project declared. Add them on the app's Projects page to read them.`, "");

  for (const c of v.vercel) {
    lines.push(`Vercel project ${q(c.title)}${c.role ? `, the ${c.role} deployment` : ""}:`);
    if (c.state !== "read") {
      lines.push(`  ${q(c.reason ?? "not read")}`, "");
      continue;
    }
    const prod = c.production;
    lines.push(`  Production: ${prod ? `${prod.state.toLowerCase()} ${prod.createdAt.slice(0, 16).replace("T", " ")} UTC${prod.commitSha ? `, ${prod.commitSha.slice(0, 7)}` : ""}${prod.commitMessage ? ` ${q(prod.commitMessage)}` : ""}${prod.errorMessage ? `. Error: ${q(prod.errorMessage)}` : ""}` : c.deploymentsPart.ok ? "no production deployment read" : notRead(c.deploymentsPart.reason)}${c.productionUrl ? `. ${c.productionUrl}` : ""}`);
    if (c.env.ok) for (const e of c.env.value) lines.push(`  Env, ${e.environment}: ${e.set} of ${e.needed} names the code needs are set${e.missing.length ? `. Missing: ${e.missing.join(", ")}` : ""}`);
    else lines.push(`  Env: ${notRead(c.env.reason)}`);
    if (c.crons.ok) lines.push(`  Crons: ${c.crons.value.expected.length === 0 ? "none expected" : c.crons.value.expected.map((e) => `${e.path} ${e.registered ? "registered" : "NOT registered"}`).join(", ")}${c.crons.value.enabled ? "" : ". Switched off on Vercel"}`);
    else lines.push(`  Crons: ${notRead(c.crons.reason)}`);
    if (c.domains.ok && c.domains.value.length > 0) lines.push(`  Domains: ${c.domains.value.map((d) => `${d.name}${d.verified === false ? " (not verified)" : ""}`).join(", ")}`);
    if (c.errors.ok && c.errors.value.length > 0) lines.push(`  Errors: ${c.errors.value.slice(0, 3).map((e) => q(e.text)).join(" | ")}`);
    if (c.keyExpiry.ok && c.keyExpiry.value) lines.push(`  Key expires ${c.keyExpiry.value.slice(0, 10)}`);
    lines.push("");
  }

  for (const c of v.supabase) {
    lines.push(`Supabase project ${q(c.title)}${c.paused ? ", PAUSED" : c.status ? `, ${c.status.toLowerCase()}` : ""}:`);
    if (c.state !== "read") {
      lines.push(`  ${q(c.reason ?? "not read")}`, "");
      continue;
    }
    lines.push(`  Size: ${c.size.ok ? `${c.size.value.mb} MB${c.size.value.limitMb ? ` of ${c.size.value.limitMb} MB (${c.size.value.plan})` : ""}` : notRead(c.size.reason)}`);
    if (c.migrations.ok) lines.push(`  Migrations: ${c.migrations.value.method === "none" ? q(c.migrations.value.how) : c.migrations.value.owed.length === 0 ? `nothing owed (${n(c.migrations.value.checked, "check")})` : `owed ${c.migrations.value.owed.map((o) => `${o.file ?? o.migration} (${o.missing.join(", ")})`).join(". ")}`}`);
    else lines.push(`  Migrations: ${notRead(c.migrations.reason)}`);
    for (const kind of ["security", "performance"] as const) {
      const p = c[kind];
      if (!p.ok) lines.push(`  ${kind} advisor: ${notRead(p.reason)}`);
      else {
        const serious = p.value.filter((l) => l.level !== "INFO");
        lines.push(`  ${kind === "security" ? "Security" : "Performance"} advisor: ${serious.length === 0 ? "no errors or warnings" : serious.slice(0, 4).map((l) => `[${l.level}] ${q(l.title)}`).join(", ")}`);
      }
    }
    lines.push("");
  }

  for (const c of v.onesignal) {
    lines.push(`OneSignal app ${q(c.title)}:`);
    if (c.state !== "read") {
      lines.push(`  ${q(c.reason ?? "not read")}`, "");
      continue;
    }
    lines.push(`  Subscribed: ${c.app.ok ? `${c.app.value.subscribed ?? "not reported"} of ${c.app.value.subscriptions ?? "?"}, set up for ${c.app.value.platforms.join(", ") || "no platform"}` : notRead(c.app.reason)}`);
    if (c.audience.ok && c.audience.value.mobileSuppressed) lines.push("  Mobile push is dropped for the plan (OneSignal's estimate).");
    if (c.notifications.ok) for (const m of c.notifications.value.recent.slice(0, 3)) lines.push(`  ${m.sentAt ? m.sentAt.slice(0, 10) : "?"} ${m.title ? q(m.title) : m.kind === "api" ? "a message sent by the app" : "a message"}: ${m.totals.successful ?? 0} delivered, ${m.totals.converted ?? 0} clicked${m.totals.errored ? `, ${m.totals.errored} errors` : ""}`);
    lines.push("");
  }

  if (map) {
    lines.push(`Services (${v.services.length}): ${v.services.map((s) => `${s.name}${s.plan ? ` [${s.plan}]` : ""}${s.projects ? ` ${s.keyed}/${s.projects} keyed` : ""}${s.found ? " (found by the model)" : ""}`).join(", ")}`);
    if (map.reader) lines.push(`The model (${map.reader.model}) read ${map.reader.filesRead} files in ${map.reader.batches} passes: ${map.reader.confirmed + map.reader.carried} finds confirmed at their lines, ${map.reader.dropped} dropped, ${map.reader.known} already on the map`);
    for (const s of v.services) if (s.purpose) lines.push(`  ${s.name}: ${s.purpose} (as read by the model)`);
    for (const f of v.alsoFound) lines.push(`Also found by the model, ${f.kind}: ${f.name}, ${f.detail} (${f.at.path}:${f.at.line})`);
    if (v.security) {
      const sev = (["critical", "high", "medium", "low"] as const).map((k) => `${k} ${v.security!.bySeverity[k] ?? 0}`).join(", ");
      lines.push(`Security: ${v.security.total} open findings (${sev})${v.security.byCategory.length > 0 ? `: ${v.security.byCategory.map((c) => `${c.label.toLowerCase()} ${c.count}`).join(", ")}` : ""}.`);
      if (v.security.scope) lines.push(`  Not checked: ${v.security.scope.notChecked.map((n) => n.label.toLowerCase()).join(", ")}.`);
    }
    if (v.money.monthlyUsd !== null) {
      lines.push(`Money: about $${v.money.monthlyUsd} a month, $${v.money.yearlyUsd} a year, as far as it is known: ${[v.money.monthlyReadUsd !== null ? `$${v.money.monthlyReadUsd} read from accounts this month` : null, v.money.monthlyListUsd !== null ? `list prices $${v.money.monthlyListUsd} a month (counted only where no spend is read)` : null, v.money.monthlyManualUsd !== null ? `$${v.money.monthlyManualUsd} a month entered by you` : null].filter(Boolean).join(", ")}.`);
      for (const l of v.money.limits.slice(0, 6)) lines.push(`  ${l.name} ${l.label.toLowerCase()}: ${l.used}${l.unit ? ` ${l.unit}` : ""} of ${l.limit} (${l.pct}%)`);
    }
    if (map.roles.length > 1) lines.push(`Deployments: ${map.roles.join(", ")} by ${map.roleEnv}`);
    for (const c of v.crons) lines.push(`Cron ${c.path}: ${c.every}${c.handler ? `, ${c.handler}${c.kind === "vercel" ? (c.checksSecret ? " checks CRON_SECRET" : " does NOT check CRON_SECRET") : ""}` : c.kind === "vercel" ? ", no handler found" : `, a ${c.kind} schedule`}${c.found ? ", found by the model" : ""} (${c.source.path}:${c.source.line})`);
    for (const w of v.webhooks) lines.push(`Webhook ${w.route}${w.service ? ` from ${w.service}` : ""}: ${w.verifies ? `verifies at ${w.verifies.path}:${w.verifies.line}` : "NO verify line found"}`);
    for (const a of v.storeApps) lines.push(`Store app: ${a.platform} ${a.bundleId ?? "no bundle id"}${a.appName ? ` ${q(a.appName)}` : ""}${a.webUrl ? `, loads ${a.webUrl}` : ""}`);
    if (v.migrations && v.migrations.files > 0) lines.push(`Migrations: ${v.migrations.files} files in ${v.migrations.dir ?? "the repository"}, latest ${v.migrations.latest ?? "?"}${v.migrations.verify ? `, ${v.migrations.verify.markers} markers in ${v.migrations.verify.path}` : ", no verify.sql"}`);
    if (v.publicSurface) lines.push(`Public pages: sitemap ${v.publicSurface.sitemap ? "yes" : "no"}, robots ${v.publicSurface.robots ? "yes" : "no"}, llms.txt ${v.publicSurface.llmsTxt ? "yes" : "no"}`);
  }
  return lines;
}

export function alertsLines(r: AlertsResponse, q: Quote = plain): string[] {
  if (r.reason) return [q(r.reason), r.email.sentence];
  const open = r.alerts.filter((a) => !a.resolvedAt);
  const closed = r.alerts.filter((a) => a.resolvedAt);
  const lines = [open.length === 0 ? "No open alerts." : `Open (${open.length}):`, ...open.map((a) => alertLine(a, q))];
  if (closed.length > 0) lines.push("", `Closed in the last two weeks (${closed.length}):`, ...closed.map((a) => alertLine(a, q)));
  if (r.deadlines.length > 0) lines.push("", "Dates to watch:", ...r.deadlines.map((d) => `- ${d.dueOn} ${q(d.label)}${d.note ? `: ${q(d.note)}` : ""}`));
  lines.push("", r.email.sentence);
  return lines;
}
