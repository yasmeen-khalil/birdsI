import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ActionRequest, Alert, Question, Vendor, VendorFact, Watch } from "@birdsi/shared";
import { FACT_SOURCE_LABEL, RECORD_AUTHOR_LABEL, RECORD_KIND_LABEL, RecordKind, commandProgram, isAllowedCommand } from "@birdsi/shared";
import { ApiClient, toCliError } from "../api";
import { readConfig } from "../config";
import { EXIT } from "../exit";
import { glyphs, paint, plural, styleFor, wrap, type Style } from "../format";
import { isInteractive, printJson, println, usageError } from "../output";
import { askText, askYesNo } from "../prompt";
import { openBrowser } from "./auth";
import { LEGEND, q } from "../quote";

/**
 * The operations layer from the terminal: vendors and limits, the questions
 * birdsI needs answered, the approvals queue, the vision, and an export that
 * writes the whole knowledge base as plain files any agent can read.
 */

interface PrintOptions {
  json?: boolean;
  ascii?: boolean;
  repo?: string;
}

/** The repository to act on: --repo (id or owner/name), else the newest scan's repository. */
export async function resolveRepo(api: ApiClient, ref: string | undefined): Promise<{ id: string; fullName: string }> {
  const repos = (await api.repos()).data.repos;
  if (ref) {
    const found = repos.find((r) => r.id === ref || r.fullName.toLowerCase() === ref.toLowerCase() || r.fullName.toLowerCase().endsWith(`/${ref.toLowerCase()}`));
    if (!found) throw usageError(`No repository called ${ref} is on your birdsI account.`, "See them all: birdsi repos");
    return { id: found.id, fullName: found.fullName };
  }
  const config = await readConfig();
  if (config.lastRepoId) {
    const found = repos.find((r) => r.id === config.lastRepoId);
    if (found) return { id: found.id, fullName: found.fullName };
  }
  if (repos.length === 1) return { id: repos[0]!.id, fullName: repos[0]!.fullName };
  throw usageError("Which repository? Run birdsi in the project folder first, or pass --repo owner/name.", "See them all: birdsi repos");
}

function levelWord(level: Alert["level"], style: Style): string {
  if (level === "critical") return paint.critical(style, "Critical");
  if (level === "warning") return paint.high(style, "Warning");
  return paint.dim(style, "Note");
}

function factLine(f: VendorFact, style: Style): string {
  const bar = f.kind === "usage" && f.numeric !== null && f.limitNumeric ? ` (${Math.round((f.numeric / f.limitNumeric) * 100)}% of the limit)` : "";
  return `    ${f.label}: ${paint.bold(style, f.value)}${bar}  ${paint.dim(style, FACT_SOURCE_LABEL[f.source].toLowerCase())}`;
}

export function formatVendors(vendors: readonly Vendor[], alerts: readonly Alert[], monthlyUsd: number | null, style: Style, watches: readonly Watch[] = []): string {
  const g = glyphs(style);
  const lines: string[] = [];
  lines.push(paint.bold(style, `${plural(vendors.length, "vendor")}${monthlyUsd !== null ? `, about $${monthlyUsd}/month where known` : ""}`));
  if (alerts.length > 0) {
    lines.push("");
    for (const a of alerts) {
      lines.push(`${levelWord(a.level, style)} ${a.title}`);
      lines.push(wrap(a.detail, style, "  "));
      if (a.suggestedCommand) lines.push(paint.dim(style, `  Try: ${a.suggestedCommand}`));
    }
  }
  if (watches.length > 0) {
    lines.push("");
    lines.push(paint.dim(style, "Tracking (might happen, not true now):"));
    for (const w of watches) lines.push(paint.dim(style, `  ${w.vendorName}: ${w.title}`));
  }
  for (const v of vendors) {
    lines.push("");
    lines.push(`${g.bullet} ${paint.bold(style, v.name)}  ${paint.dim(style, v.category)}${v.connected ? `  ${paint.ok(style, "connected")}` : v.connectable ? `  ${paint.dim(style, "connect it in Settings")}` : ""}`);
    if (v.what) lines.push(wrap(v.what, style, "    "));
    if (v.purpose) lines.push(wrap(`Used for: ${v.purpose}`, style, "    "));
    const order: VendorFact["kind"][] = ["plan", "cost", "usage", "limit", "billing", "status"];
    const facts = [...v.facts].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
    for (const f of facts.slice(0, 10)) lines.push(factLine(f, style));
    if (v.callSites.length > 0) lines.push(paint.dim(style, `    Used in ${plural(v.callSites.length, "place")}, for example ${v.callSites[0]!.path}:${v.callSites[0]!.line}`));
  }
  return lines.join("\n");
}

export async function vendorsCommand(options: PrintOptions & { sync?: boolean }): Promise<number> {
  const style = styleFor(process.stdout, options);
  const { api } = await ApiClient.fromEnvironment();
  api.requireAuth();
  try {
    const repo = await resolveRepo(api, options.repo);
    if (options.sync) {
      await api.syncVendors(repo.id);
      if (!options.json) println(paint.dim(style, "Refreshing vendors from connected accounts and current pricing pages. Check again in a minute."));
    }
    const result = await api.vendors(repo.id);
    if (options.json) {
      printJson(result.raw);
      return EXIT.ok;
    }
    println(paint.dim(style, repo.fullName));
    println(formatVendors(result.data.vendors, result.data.alerts, result.data.monthlyUsd, style, result.data.watches));
    const stale = result.data.stages.filter((s) => s.freshness === "stale" || s.freshness === "never");
    if (stale.length > 0) {
      println();
      println(paint.dim(style, `Stages out of date: ${stale.map((s) => s.label.toLowerCase()).join(", ")}. Run birdsi to refresh everything in order.`));
    }
    return EXIT.ok;
  } catch (error) {
    throw toCliError(error, "the vendors");
  }
}

function questionBlock(q: Question, i: number, style: Style): string {
  const lines = [`${paint.bold(style, `${i + 1}. ${q.question}`)}${q.vendorName ? `  ${paint.dim(style, q.vendorName)}` : ""}${q.askedBy === "agent" ? `  ${paint.accent(style, "asked by your agent")}` : ""}`];
  lines.push(wrap(q.why, style, "   "));
  if (q.options.length > 0) lines.push(paint.dim(style, `   Options: ${q.options.join(", ")}`));
  if (q.lookupUrl) lines.push(paint.dim(style, `   Where to look: ${q.lookupUrl}`));
  return lines.join("\n");
}

export async function questionsCommand(options: PrintOptions & { answer?: boolean }): Promise<number> {
  const style = styleFor(process.stdout, options);
  const { api } = await ApiClient.fromEnvironment();
  api.requireAuth();
  try {
    const repo = await resolveRepo(api, options.repo);
    const result = await api.questions(repo.id, "open");
    if (options.json) {
      printJson(result.raw);
      return EXIT.ok;
    }
    const open = result.data.questions;
    if (open.length === 0) {
      println("Nothing to answer. When birdsI or your agent cannot find something out, it asks here.");
      return EXIT.ok;
    }
    println(paint.dim(style, repo.fullName));
    println(paint.bold(style, `${plural(open.length, "question")} for you`));
    println();
    for (const [i, q] of open.entries()) {
      println(questionBlock(q, i, style));
      println();
    }
    if (options.answer === false || !isInteractive()) {
      println(paint.dim(style, "Answer them with: birdsi questions --answer, or in the dashboard."));
      return EXIT.ok;
    }
    for (const q of open) {
      println(paint.accent(style, q.question));
      if (q.options.length > 0) println(paint.dim(style, `(${q.options.map((o, i) => `${i + 1} ${o}`).join(", ")}, or type an answer, or Enter to skip)`));
      else println(paint.dim(style, "(type an answer, or Enter to skip)"));
      const raw = await askText("> ");
      if (raw === null) return EXIT.stopped;
      const trimmed = raw.trim();
      if (!trimmed) {
        println(paint.dim(style, "  Skipped."));
        continue;
      }
      const picked = /^\d+$/.test(trimmed) && q.options[Number(trimmed) - 1] ? q.options[Number(trimmed) - 1]! : trimmed;
      await api.answerQuestion(q.id, picked);
      println(`  ${paint.ok(style, glyphs(style).done)} Saved: ${picked}`);
    }
    return EXIT.ok;
  } catch (error) {
    throw toCliError(error, "the questions");
  }
}

function actionBlock(a: ActionRequest, style: Style): string {
  const who = a.requestedBy === "agent" ? "your agent" : a.requestedBy === "birdsi" ? "birdsI" : "you";
  const cost = a.estimatedMonthlyUsd !== null ? `$${a.estimatedMonthlyUsd}/month` : a.estimatedOnceUsd !== null ? `$${a.estimatedOnceUsd} once` : "no cost given";
  const lines = [`${paint.bold(style, a.title)}  ${paint.dim(style, `${a.status}, from ${who}, ${cost}`)}`];
  lines.push(wrap(a.reason, style, "   "));
  lines.push(`   ${paint.accent(style, a.command)}`);
  lines.push(paint.dim(style, `   id ${a.id}`));
  return lines.join("\n");
}

/** The environment a command sees: enough to find its tools and its own config, none of this shell's secrets. */
function commandEnv(): NodeJS.ProcessEnv {
  const keep = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "TERM", "TMPDIR", "XDG_CONFIG_HOME", "APPDATA", "LOCALAPPDATA", "SYSTEMROOT", "USERPROFILE"];
  const env: NodeJS.ProcessEnv = { NO_COLOR: "1" };
  for (const k of keep) if (process.env[k]) env[k] = process.env[k];
  return env;
}

/**
 * Runs one approved command on this machine and reports the outcome. The
 * command is shown verbatim and runs only after a yes, only when its program
 * is on the allowlist, and with a minimal environment.
 */
async function runApproved(api: ApiClient, a: ActionRequest, cwd: string, style: Style, yes: boolean): Promise<void> {
  println(actionBlock(a, style));
  if (!isAllowedCommand(a.command)) {
    println(`  ${paint.fail(style, glyphs(style).failed)} Not run: "${commandProgram(a.command)}" is not an allowed program, or the command contains shell operators.`);
    await api.reportAction(a.id, false, `Refused by the terminal tool: ${commandProgram(a.command)} is not an allowed program.`);
    return;
  }
  if (!yes) {
    const ok = await askYesNo(paint.accent(style, "Run this command here now? [y/N]"));
    if (!ok) {
      println(paint.dim(style, "  Not run."));
      return;
    }
  }
  const [command, ...args] = a.command.split(/\s+/);
  const output = await new Promise<{ ok: boolean; text: string }>((done) => {
    try {
      execFile(command!, args, { cwd, timeout: 10 * 60_000, maxBuffer: 8 * 1024 * 1024, env: commandEnv() }, (error, stdout, stderr) => {
        done({ ok: !error, text: `${stdout ?? ""}${stderr ? `\n${stderr}` : ""}${error && !stdout && !stderr ? `\n${error.message}` : ""}`.trim() });
      });
    } catch (error) {
      done({ ok: false, text: error instanceof Error ? error.message : String(error) });
    }
  });
  await api.reportAction(a.id, output.ok, output.text);
  println(output.ok ? `  ${paint.ok(style, glyphs(style).done)} Done.` : `  ${paint.fail(style, glyphs(style).failed)} The command failed.`);
  if (output.text) println(paint.dim(style, output.text.split("\n").slice(0, 20).map((l) => `    ${l}`).join("\n")));
}

export async function approvalsCommand(sub: string | undefined, id: string | undefined, options: PrintOptions & { yes?: boolean; path?: string }): Promise<number> {
  const style = styleFor(process.stdout, options);
  const { api } = await ApiClient.fromEnvironment();
  api.requireAuth();
  try {
    const repo = await resolveRepo(api, options.repo);
    if (sub === "approve" || sub === "deny") {
      // Deciding is a person's act and happens in the browser, never with this token.
      const url = `${api.baseUrl}/app/${repo.id}/agent`;
      println(`Approvals are decided in the browser, so an agent can never approve its own request.`);
      println(paint.dim(style, `Open: ${url}`));
      if (process.stdout.isTTY) openBrowser(url);
      return EXIT.ok;
    }
    if (sub === "run") {
      const approved = (await api.actions(repo.id, "approved")).data.actions.filter((a) => !id || a.id === id);
      if (approved.length === 0) {
        println("Nothing approved is waiting to run.");
        return EXIT.ok;
      }
      if (!isInteractive() && !options.yes) throw usageError("Running approved commands needs your yes.", "Add --yes to run them without the prompt.");
      const cwd = resolve(options.path ?? process.cwd());
      for (const a of approved) await runApproved(api, a, cwd, style, Boolean(options.yes));
      return EXIT.ok;
    }
    const result = await api.actions(repo.id);
    if (options.json) {
      printJson(result.raw);
      return EXIT.ok;
    }
    const pending = result.data.actions.filter((a) => a.status === "pending");
    const approved = result.data.actions.filter((a) => a.status === "approved");
    const recent = result.data.actions.filter((a) => a.status !== "pending" && a.status !== "approved").slice(0, 5);
    println(paint.dim(style, repo.fullName));
    println(paint.bold(style, `${plural(pending.length, "command")} waiting for your approval, ${approved.length} approved and not run yet`));
    for (const a of pending) {
      println();
      println(actionBlock(a, style));
    }
    for (const a of approved) {
      println();
      println(actionBlock(a, style));
    }
    if (recent.length > 0) {
      println();
      println(paint.dim(style, "Recent:"));
      for (const a of recent) println(paint.dim(style, `  ${a.status}: ${a.title}`));
    }
    println();
    const policy = result.data.policy;
    println(paint.dim(style, `Policy: agents ${policy.allowPropose ? "may" : "may not"} propose commands. Auto-approve: ${policy.autoApproveUnderUsd === null ? "always ask" : `at or under $${policy.autoApproveUnderUsd}/month for ${policy.autoApprovePrefixes.join(", ")}`}.`));
    println(paint.dim(style, "Decide with: birdsi approvals approve <id> | deny <id>. Run approved commands here with: birdsi approvals run"));
    return EXIT.ok;
  } catch (error) {
    throw toCliError(error, "the approvals");
  }
}

export async function visionCommand(text: string[] | undefined, options: PrintOptions & { file?: string }): Promise<number> {
  const style = styleFor(process.stdout, options);
  const { api } = await ApiClient.fromEnvironment();
  api.requireAuth();
  try {
    const repo = await resolveRepo(api, options.repo);
    let next: string | null = null;
    if (options.file) next = await (await import("node:fs/promises")).readFile(resolve(options.file), "utf8");
    else if (text && text.length > 0) next = text.join(" ");
    if (next !== null) {
      const { vision } = (await api.setVision(repo.id, next)).data;
      if (options.json) printJson({ vision });
      else println(`${paint.ok(style, "Saved")} the vision for ${repo.fullName} (${vision.text.length} characters).`);
      return EXIT.ok;
    }
    const { vision } = (await api.vision(repo.id)).data;
    if (options.json) {
      printJson({ vision });
      return EXIT.ok;
    }
    if (!vision.text) {
      println("No vision written yet. The vision is what you are building and why; birdsI and your agent read it.");
      println(paint.dim(style, 'Write it with: birdsi vision "What this app is for and where it is going", or --file VISION.md'));
      return EXIT.ok;
    }
    println(paint.dim(style, `${repo.fullName}, updated ${vision.updatedAt ?? "unknown"}`));
    println(vision.text);
    return EXIT.ok;
  } catch (error) {
    throw toCliError(error, "the vision");
  }
}

/** Writes the knowledge base as Markdown under .birdsi/ so agents without MCP can read it. */
export async function exportCommand(options: PrintOptions & { path?: string }): Promise<number> {
  const style = styleFor(process.stdout, options);
  const { api } = await ApiClient.fromEnvironment();
  api.requireAuth();
  try {
    const repo = await resolveRepo(api, options.repo);
    const [inventory, questions, actions, record] = await Promise.all([api.inventory(repo.id), api.questions(repo.id, "open"), api.actions(repo.id, "pending"), api.record(repo.id, { limit: 200 })]);
    const dir = join(resolve(options.path ?? process.cwd()), ".birdsi");
    await mkdir(dir, { recursive: true });
    const inv = inventory.data;
    const vendorsMd = [
      `# Vendors of ${inv.repo.fullName}`,
      "",
      `Generated by birdsI on ${new Date().toISOString().slice(0, 10)}. ${inv.vendors.length} outside services (vendors) the app runs on.`,
      "",
      ...inv.vendors.flatMap((v) => [
        `## ${v.name}`,
        "",
        `${v.what ? q(v.what) : "(no description yet)"}${v.purpose ? ` Used here for: ${q(v.purpose)}` : ""}`,
        "",
        `- Category: ${v.category}`,
        `- Found by: ${v.detectedBy.join(", ")}${v.packages.length ? `; packages ${v.packages.join(", ")}` : ""}${v.envVars.length ? `; env ${v.envVars.join(", ")}` : ""}`,
        ...(v.pricingUrl ? [`- Pricing: ${v.pricingUrl}`] : []),
        ...v.facts.map((f) => `- ${q(f.label)}: ${q(f.value)} (${FACT_SOURCE_LABEL[f.source].toLowerCase()}${f.evidence.url ? `, ${f.evidence.url}` : ""})`),
        ...(v.callSites.length ? ["", "Used in:", ...v.callSites.slice(0, 12).map((c) => `- ${q(c.path)}:${c.line}`)] : []),
        "",
      ]),
    ].join("\n");
    const alertsMd = [`# Alerts`, "", ...(inv.alerts.length ? inv.alerts.map((a) => `- [${a.level}] ${q(a.title)}: ${q(a.detail)}${a.suggestedCommand ? ` Try: ${q(a.suggestedCommand)}` : ""}`) : ["None."]), ""].join("\n");
    const questionsMd = [`# Questions for the owner`, "", ...(questions.data.questions.length ? questions.data.questions.map((x) => `- ${q(x.question)} (${q(x.why)})${x.options.length ? ` Options: ${q(x.options.join(", "))}` : ""}`) : ["None open."]), "", `# Pending approvals`, "", ...(actions.data.actions.length ? actions.data.actions.map((a) => `- ${q(a.title)}: ${q(a.command)} (${q(a.reason)})`) : ["None."]), ""].join("\n");
    const recordMd = [
      `# The record`,
      "",
      `What was decided, stated, fixed, answered, approved and run for ${inv.repo.fullName}, by whom and why. Newest first. Read it before deciding something that may already be decided.`,
      "",
      ...(record.data.entries.length ? record.data.entries.map((e) => `- ${e.createdAt.slice(0, 16).replace("T", " ")} ${RECORD_KIND_LABEL[e.kind]} by ${e.authorLabel ?? RECORD_AUTHOR_LABEL[e.authorKind]}: ${q(e.text)}${e.why ? ` (why: ${q(e.why)})` : ""}${e.subject ? ` [${q(e.subject)}]` : ""}`) : ["Nothing on record yet."]),
      "",
    ].join("\n");
    const readme = [
      `# birdsI knowledge base`,
      "",
      `This folder is written by \`birdsi export\` and read by coding agents. It describes everything outside the code that makes ${inv.repo.fullName} run.`,
      "",
      `- vision.md: what the app is for and where it is going, in the owner's words`,
      `- vendors.md: every outside service, its plan, limits, usage and where the code uses it`,
      `- alerts.md: what is true now and needs attention, like a limit at 80% or an account that could not be read`,
      `- questions.md: what only the owner can answer, and commands waiting for approval`,
      `- record.md: decisions, facts, fixed marks, answers, approvals and runs, with who and why`,
      "",
      `Pipeline stages: ${inv.stages.map((s) => `${s.label} (${s.freshness})`).join(", ")}.`,
      "",
      `For live data, run the birdsI MCP server: \`npx birdsi mcp\`.`,
      "",
      LEGEND,
      "",
    ].join("\n");
    // Every file opens with the legend, since an agent may read one file without the README.
    const withLegend = (md: string) => md.replace(/^(# [^\n]*\n)/, `$1\n${LEGEND}\n`);
    await Promise.all([
      // Plans, spend and the owner's record stay out of git unless the owner chooses otherwise.
      writeFile(join(dir, ".gitignore"), "*\n"),
      writeFile(join(dir, "README.md"), readme),
      writeFile(join(dir, "vision.md"), `# Vision\n\n${inv.vision.text || "(not written yet)"}\n`),
      writeFile(join(dir, "vendors.md"), withLegend(vendorsMd)),
      writeFile(join(dir, "record.md"), withLegend(recordMd)),
      writeFile(join(dir, "alerts.md"), withLegend(alertsMd)),
      writeFile(join(dir, "questions.md"), withLegend(questionsMd)),
    ]);
    if (options.json) printJson({ dir, files: ["README.md", "vision.md", "vendors.md", "alerts.md", "questions.md"] });
    else println(`${paint.ok(style, "Wrote")} ${dir} (vision, vendors, alerts, questions). Agents can read these files directly.`);
    return EXIT.ok;
  } catch (error) {
    throw toCliError(error, "the export");
  }
}

/** The one-line status printed after the default command: alerts, questions, approvals. */
export function formatNeedsYou(openQuestions: number, pendingActions: number, alerts: readonly Alert[], dashboardUrl: string | null, style: Style): string {
  const lines: string[] = [];
  const serious = alerts.filter((a) => a.level !== "info");
  if (serious.length > 0) lines.push(`${paint.high(style, plural(serious.length, "limit alert"))}: ${serious.map((a) => a.title).join("; ")}`);
  if (openQuestions > 0) lines.push(`${plural(openQuestions, "question")} for you: birdsi questions --answer`);
  if (pendingActions > 0) lines.push(`${plural(pendingActions, "command")} waiting for approval: birdsi approvals`);
  if (dashboardUrl) lines.push(paint.dim(style, `Dashboard: ${dashboardUrl}`));
  return lines.join("\n");
}

/** The whole knowledge base in one read: vision, vendors, alerts, stages, what needs the owner. */
export async function inventoryCommand(options: PrintOptions): Promise<number> {
  const style = styleFor(process.stdout, options);
  const { api } = await ApiClient.fromEnvironment();
  api.requireAuth();
  try {
    const repo = await resolveRepo(api, options.repo);
    const result = await api.inventory(repo.id);
    if (options.json) {
      printJson(result.raw);
      return EXIT.ok;
    }
    const inv = result.data;
    println(paint.bold(style, inv.repo.fullName));
    println(wrap(inv.vision.text ? `Vision: ${inv.vision.text}` : "Vision: not written yet (birdsi vision \"...\")", style, ""));
    println(paint.dim(style, `Stages: ${inv.stages.map((s) => `${s.label} ${s.freshness}`).join(", ")}`));
    if (inv.latestScan) println(paint.dim(style, `Latest scan: ${inv.latestScan.kind}, ${plural(inv.latestScan.findings, "open finding")}`));
    if (inv.decisions.length > 0) {
      println();
      println(paint.bold(style, "Decisions on record"));
      for (const d of inv.decisions.slice(0, 8)) println(wrap(`${d.createdAt.slice(0, 10)}  ${d.text}${d.why ? paint.dim(style, ` (why: ${d.why})`) : ""}`, style, "  "));
    }
    println();
    println(formatVendors(inv.vendors, inv.alerts, null, style, inv.watches));
    println();
    println(formatNeedsYou(inv.openQuestions, inv.pendingActions, inv.alerts, `${api.baseUrl}/app/${repo.id}`, style));
    return EXIT.ok;
  } catch (error) {
    throw toCliError(error, "the inventory");
  }
}

/** New and resolved findings since the previous scan, by stable key. */
export async function changesCommand(since: string | undefined, options: PrintOptions): Promise<number> {
  const style = styleFor(process.stdout, options);
  const { api } = await ApiClient.fromEnvironment();
  api.requireAuth();
  try {
    const repo = await resolveRepo(api, options.repo);
    const result = await api.changes(repo.id, since);
    if (options.json) {
      printJson(result.raw);
      return EXIT.ok;
    }
    const c = result.data;
    println(paint.bold(style, `${plural(c.newFindings.length, "new finding")}, ${c.resolved.length} resolved, ${c.stillOpen} still open, ${c.dismissed} dismissed`));
    println(paint.dim(style, c.from ? `Since scan ${c.from.scanId.slice(0, 8)} (${c.from.finishedAt ?? "unknown"})` : "No earlier scan to compare with."));
    for (const f of c.newFindings) println(`  + ${f.severity.padEnd(8)} ${f.title}${f.path ? paint.dim(style, `  ${f.path}`) : ""}`);
    for (const f of c.resolved) println(paint.dim(style, `  - ${f.severity.padEnd(8)} ${f.title}${f.path ? `  ${f.path}` : ""}`));
    return EXIT.ok;
  } catch (error) {
    throw toCliError(error, "the changes");
  }
}

/** The record: decisions, facts, fixed marks, answers, approvals and runs, newest first. */
export async function recordCommand(options: PrintOptions & { kind?: string; limit?: string }): Promise<number> {
  const style = styleFor(process.stdout, options);
  const { api } = await ApiClient.fromEnvironment();
  api.requireAuth();
  try {
    const repo = await resolveRepo(api, options.repo);
    const kind = options.kind ? RecordKind.parse(options.kind) : undefined;
    const limit = options.limit ? Number.parseInt(options.limit, 10) || 50 : 50;
    const result = await api.record(repo.id, { ...(kind ? { kind } : {}), limit });
    if (options.json) {
      printJson(result.raw);
      return EXIT.ok;
    }
    const entries = result.data.entries;
    if (entries.length === 0) {
      println(paint.dim(style, kind ? `Nothing of kind ${kind} on record yet.` : "Nothing on record yet. Decisions, answers, approvals and fixed marks land here."));
      return EXIT.ok;
    }
    for (const e of entries) {
      const when = e.createdAt.slice(0, 16).replace("T", " ");
      println(`${paint.dim(style, when)}  ${paint.bold(style, RECORD_KIND_LABEL[e.kind])}  ${paint.dim(style, `by ${e.authorLabel ?? RECORD_AUTHOR_LABEL[e.authorKind]}`)}`);
      println(wrap(e.text, style, "    "));
      if (e.why) println(paint.dim(style, wrap(`Why: ${e.why}`, style, "    ")));
    }
    return EXIT.ok;
  } catch (error) {
    throw toCliError(error, "the record");
  }
}

/** The owner writes a decision to the record, so no agent asks about it again. */
export async function decideCommand(text: string[], options: { why?: string; repo?: string; json?: boolean }): Promise<number> {
  const { api } = await ApiClient.fromEnvironment();
  api.requireAuth();
  const joined = text.join(" ").trim();
  if (!joined) throw usageError("Write the decision.", 'Example: birdsi decide "We stay on the Supabase free plan until 1,000 users" --why "cost"');
  try {
    const repo = await resolveRepo(api, options.repo);
    const result = await api.writeRecord(repo.id, { kind: "decision", text: joined, ...(options.why ? { why: options.why } : {}) });
    if (options.json) printJson(result.raw);
    else println("On record.");
    return EXIT.ok;
  } catch (error) {
    throw toCliError(error, "the decision");
  }
}
