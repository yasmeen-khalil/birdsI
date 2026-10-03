import { isAbsolute, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ActionKind,
  Confidence,
  ScanKind,
  Severity,
  type Finding,
  type ScanEventRecord,
  type ScanResponse,
} from "@birdsi/shared";
import { z } from "zod";
import { ApiClient, toCliError } from "../api";
import { readConfig } from "../config";
import { CONFIDENCE_WORD, KIND_WORD, PLAIN, countsLine, fixStatusLine, formatAudit, formatFindingDetail, locationText, orderFindings, sandboxResult, STEP_LABEL } from "../format";
import { applyPatchLocally, manualApplyCommand } from "../patch";
import { VERSION } from "../version";
import { followScan, sendSnapshot, startScan, waitForFix } from "../workflow";

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

function text(body: string): ToolResult {
  return { content: [{ type: "text", text: body }] };
}

function failure(error: unknown, what?: string): ToolResult {
  const cli = toCliError(error, what);
  return { content: [{ type: "text", text: cli.hint ? `${cli.message}\n${cli.hint}` : cli.message }], isError: true };
}

/** Wraps a handler: fresh client per call (so a login mid-session is picked up), errors as tool errors. */
function tool<A>(what: string, fn: (api: ApiClient, args: A) => Promise<ToolResult>): (args: A) => Promise<ToolResult> {
  return async (args: A) => {
    try {
      const { api } = await ApiClient.fromEnvironment();
      api.client = "mcp";
      if (!api.signedIn) {
        return {
          content: [{ type: "text", text: "Not signed in to birdsI. Ask the owner to run birdsi login in a terminal, or set BIRDSI_TOKEN in this server's environment." }],
          isError: true,
        };
      }
      return await fn(api, args);
    } catch (error) {
      return failure(error, what);
    }
  };
}

/** One line per finding, with the id an agent needs for the next call. */
export function compactFinding(f: Pick<Finding, "id" | "severity" | "confidence" | "title" | "location" | "actionKind">): string {
  const where = locationText(f);
  return `- [${f.severity}] ${f.title}${where ? ` (${where})` : ""}. ${CONFIDENCE_WORD[f.confidence]}. ${f.actionKind === "fix" ? "birdsI can fix this" : "Needs you"}. id: ${f.id}`;
}

function summarize(result: ScanResponse, top = 10): string {
  const { scan, findings } = result;
  const ordered = orderFindings(findings.filter((f) => f.status !== "dismissed" && f.status !== "fixed"));
  const fixable = ordered.filter((f) => f.actionKind === "fix").length;
  const lines = [
    `${KIND_WORD[scan.kind]} ${scan.id}: ${scan.status}.`,
    countsLine(ordered.length, fixable, ordered.length - fixable),
  ];
  if (scan.summary?.headline) lines.push(scan.summary.headline);
  if (scan.summary) {
    const s = scan.summary.bySeverity;
    lines.push(`By severity: critical ${s.critical ?? 0}, high ${s.high ?? 0}, medium ${s.medium ?? 0}, low ${s.low ?? 0}.`);
  }
  if (scan.audit) lines.push("", formatAudit(scan.audit, PLAIN));
  if (scan.error) lines.push(`Error: ${scan.error}`);
  if (ordered.length > 0) {
    lines.push("", ordered.length > top ? `Top ${top} findings:` : "Findings:");
    for (const f of ordered.slice(0, top)) lines.push(compactFinding(f));
    if (ordered.length > top) lines.push(`${ordered.length - top} more: call birdsi_findings with scanId ${scan.id}.`);
    lines.push("", "Confidence: Proven means a fixed rule or tool found it. Doc-verified means checked against current official docs, which are cited. Judgment means the model's reading of the code; verify before acting on it.");
  }
  return lines.join("\n");
}

/** Plain progress from an event log: steps done, the running step, findings so far. */
function progressFrom(events: readonly ScanEventRecord[]): string {
  const done: string[] = [];
  let running: string | null = null;
  let progress = "";
  let findings = 0;
  const notes: string[] = [];
  for (const { event } of events) {
    if (event.type === "step_started") {
      running = event.label || STEP_LABEL[event.step];
      progress = "";
    } else if (event.type === "step_progress") {
      progress = event.total !== undefined ? `${event.done} of ${event.total}` : `${event.done}`;
    } else if (event.type === "step_done") {
      done.push(STEP_LABEL[event.step]);
      running = null;
    } else if (event.type === "finding") {
      findings += 1;
    } else if (event.type === "note") {
      notes.push(event.text);
    }
  }
  const lines: string[] = [];
  if (done.length > 0) lines.push(`Done: ${done.join(", ")}.`);
  if (running) lines.push(`Now: ${running}${progress ? `, ${progress}` : ""}.`);
  lines.push(`Findings so far: ${findings}.`);
  for (const n of notes.slice(-3)) lines.push(`Note: ${n}`);
  return lines.join("\n");
}

export function createServer(): McpServer {
  const server = new McpServer({ name: "birdsi", version: VERSION });

  server.registerTool(
    "birdsi_scan",
    {
      title: "Scan a local folder",
      description:
        "Uploads a snapshot of a local folder (files .gitignore leaves out stay local) and scans it: exposed keys, published vulnerabilities, security problems, contradictions between files, and code that disagrees with current docs. Waits by default and returns the counts, a headline, and the top 10 findings with their ids. Use full for the whole pipeline, including vendors and limits.",
      inputSchema: {
        path: z.string().describe("Absolute path of the folder to scan."),
        kind: ScanKind.optional().describe("light: Quick check, about 1 minute (default). deep: reads all the code, about 6 minutes. audit: Pre-launch audit with a verdict per area, about 25 minutes."),
        full: z.boolean().optional().describe("Full scan: the whole pipeline in order (map the code, check docs, audit, refresh vendors and limits). Implies deep."),
        describe: z.string().max(2000).optional().describe("What the app does, in a sentence or two. Helps birdsI judge what matters."),
        wait: z.boolean().optional().describe("Wait for the scan to finish, up to 30 minutes (default true). With false, returns the scan id at once; poll with birdsi_scan_status."),
      },
    },
    tool("that folder", async (api, args: { path: string; kind?: z.infer<typeof ScanKind> | undefined; full?: boolean | undefined; describe?: string | undefined; wait?: boolean | undefined }) => {
      const root = isAbsolute(args.path) ? args.path : resolve(process.cwd(), args.path);
      const sent = await sendSnapshot(api, root);
      const kind = args.full ? "deep" : (args.kind ?? "light");
      const scan = await startScan(api, { snapshotId: sent.snapshotId, kind, branch: sent.branch, describe: args.describe, ...(args.full ? { full: true } : {}) });
      if (args.wait === false) {
        return text(`Started ${KIND_WORD[kind].toLowerCase()} ${scan.id} on ${sent.walk.files.length} files${scan.repoId ? ` (repository id ${scan.repoId})` : ""}. Check it with birdsi_scan_status.${scan.dashboardUrl ? ` Dashboard: ${scan.dashboardUrl}` : ""}`);
      }
      const status = await followScan(api, scan.id, { onEvents: () => undefined, timeoutMs: 30 * 60_000 });
      if (status !== "done" && status !== "failed" && status !== "stopped") {
        return text(`Scan ${scan.id} is still running after 30 minutes. Check it with birdsi_scan_status.`);
      }
      return text(summarize((await api.scan(scan.id)).data));
    }),
  );

  server.registerTool(
    "birdsi_scan_status",
    {
      title: "Scan status",
      description: "While a scan runs: its status, the steps done, the step running now, and findings so far. Once it has finished, failed or stopped: the same summary birdsi_scan returns, with the top findings and their ids.",
      inputSchema: { scanId: z.string() },
    },
    tool("that scan", async (api, args: { scanId: string }) => {
      const events = await api.scanEvents(args.scanId, 0);
      if (events.data.status === "done" || events.data.status === "failed" || events.data.status === "stopped") {
        return text(summarize((await api.scan(args.scanId)).data));
      }
      return text(`Scan ${args.scanId}: ${events.data.status}.\n${progressFrom(events.data.events)}`);
    }),
  );

  server.registerTool(
    "birdsi_findings",
    {
      title: "List findings",
      description: "Every finding of a scan as one line each (severity, title, file:line, confidence, who acts, id), most serious first. Filter by severity, confidence, or actionKind (fix: birdsI can fix it; steps: the owner must act).",
      inputSchema: {
        scanId: z.string(),
        severity: Severity.optional(),
        confidence: Confidence.optional(),
        actionKind: ActionKind.optional(),
      },
    },
    tool("that scan", async (api, args: { scanId: string; severity?: string | undefined; confidence?: string | undefined; actionKind?: string | undefined }) => {
      const { findings } = (await api.scan(args.scanId)).data;
      const filtered = orderFindings(findings).filter(
        (f) =>
          (!args.severity || f.severity === args.severity) &&
          (!args.confidence || f.confidence === args.confidence) &&
          (!args.actionKind || f.actionKind === args.actionKind),
      );
      if (filtered.length === 0) return text("No findings match.");
      return text([`${filtered.length} of ${findings.length} findings:`, ...filtered.map(compactFinding)].join("\n"));
    }),
  );

  server.registerTool(
    "birdsi_finding",
    {
      title: "Explain a finding",
      description: "One finding in full: what is wrong, why it matters, the evidence (code excerpt, rule, advisory or cited doc), the steps or fix plan, any fix in progress, and what its confidence label means. Call before changing code for a finding.",
      inputSchema: { findingId: z.string() },
    },
    tool("that finding", async (api, args: { findingId: string }) => {
      const { finding, fix } = (await api.finding(args.findingId)).data;
      return text(formatFindingDetail(finding, fix, PLAIN));
    }),
  );

  server.registerTool(
    "birdsi_fix",
    {
      title: "Fix a finding",
      description:
        "For a finding with actionKind fix: birdsI writes the change and runs the project's build and tests on a separate copy. Returns the pull request link for repositories connected through the GitHub App, otherwise the patch. With apply and a local path, applies the patch there with git apply. Fails for steps findings.",
      inputSchema: {
        findingId: z.string(),
        apply: z.boolean().optional().describe("Apply the patch to the local folder at path."),
        path: z.string().optional().describe("Absolute path of the local folder to apply the patch in."),
      },
    },
    tool("that finding", async (api, args: { findingId: string; apply?: boolean | undefined; path?: string | undefined }) => {
      const { finding } = (await api.finding(args.findingId)).data;
      if (finding.actionKind !== "fix") {
        return { content: [{ type: "text", text: "birdsI cannot fix this finding itself. Call birdsi_finding for the steps the owner must take." }], isError: true };
      }
      if (args.apply && !args.path) {
        return { content: [{ type: "text", text: "To apply the fix, pass path: the local folder to change." }], isError: true };
      }
      const started = (await api.startFix(finding.id)).data.fix;
      const fix = await waitForFix(api, started, { expectPr: finding.repoId !== null });
      const lines = [fixStatusLine(fix)];
      const result = sandboxResult(fix);
      if (result) lines.push(`Test result: ${result}`);
      if (fix.status === "failed") return { content: [{ type: "text", text: lines.join("\n") }], isError: true };
      if (fix.prUrl) {
        lines.push(`Pull request: ${fix.prUrl}`);
      } else if (fix.patch) {
        if (args.apply && args.path) {
          const dir = isAbsolute(args.path) ? args.path : resolve(process.cwd(), args.path);
          const applied = await applyPatchLocally(dir, fix.patch, fix.id);
          if (applied.applied) lines.push(`Applied to ${dir}. Changed: ${applied.files.join(", ")}.`);
          else lines.push(`Could not apply (${applied.reason}). Saved to ${applied.patchFile}. Apply with: ${manualApplyCommand(applied.patchFile, fix.patch)}`);
        } else {
          lines.push("Patch:", "", fix.patch);
        }
      }
      if (finding.fixPlan && finding.fixPlan.followUp.length > 0) {
        lines.push("", "The owner still needs to:", ...finding.fixPlan.followUp.map((f) => `- ${f}`));
      }
      return text(lines.join("\n"));
    }),
  );

  // The operations layer: what agents cannot see from the code alone.

  const repoArg = { repoId: z.string().optional().describe("Repository id from birdsi_repos. Defaults to the repository scanned last from this computer.") };
  async function repoIdFrom(api: ApiClient, given: string | undefined): Promise<string> {
    if (given) return given;
    const config = await readConfig();
    if (config.lastRepoId) return config.lastRepoId;
    const { repos } = (await api.repos()).data;
    if (repos.length === 1) return repos[0]!.id;
    throw new Error("Pass repoId: there is no repository scanned last from this computer. Call birdsi_repos to list them.");
  }

  server.registerTool(
    "birdsi_inventory",
    {
      title: "Project overview",
      description:
        "Call this first. Returns the owner's vision, every vendor (outside service the app runs on) with plan, usage, limits and spend, the alerts that are true now (a limit at 80% or 95%, an account that could not be read), conditions being tracked, the pipeline stages and how fresh each is, counts of open questions and pending approvals, and the latest scan.",
      inputSchema: repoArg,
    },
    tool("that repository", async (api, args: { repoId?: string | undefined }) => {
      const inv = (await api.inventory(await repoIdFrom(api, args.repoId))).data;
      const lines = [`${inv.repo.fullName} (id ${inv.repo.id})`, ""];
      lines.push(`Vision: ${inv.vision.text ? inv.vision.text : "(not written yet; ask the owner with birdsi_ask_owner if you need it)"}`, "");
      lines.push(`Stages: ${inv.stages.map((s) => `${s.label}: ${s.freshness}${s.lastRunAt ? ` (${s.lastRunAt})` : ""}`).join("; ")}`);
      if (inv.latestScan) lines.push(`Latest scan: ${inv.latestScan.kind} ${inv.latestScan.id}, ${inv.latestScan.findings} open findings${inv.latestScan.headline ? `. ${inv.latestScan.headline}` : ""}`);
      lines.push("");
      lines.push(`Alerts (${inv.alerts.length}):`, ...(inv.alerts.length ? inv.alerts.map((a) => `- [${a.level}] ${a.title}. ${a.detail}${a.suggestedCommand ? ` Suggested: ${a.suggestedCommand}` : ""}`) : ["- none"]), "");
      if (inv.watches.length > 0) lines.push(`Tracking (might happen, not true now):`, ...inv.watches.map((w) => `- ${w.vendorName}: ${w.title}. ${w.detail}${w.needs ? ` To know for sure: ${w.needs}` : ""}`), "");
      lines.push(`Vendors (${inv.vendors.length}):`);
      for (const v of inv.vendors) {
        const plan = v.facts.find((f) => f.kind === "plan");
        const usage = v.facts.filter((f) => f.kind === "usage").slice(0, 3).map((f) => `${f.label} ${f.value}`);
        const cost = v.facts.find((f) => f.kind === "cost");
        lines.push(`- ${v.name} (${v.slug}, ${v.category}): ${v.purpose ?? v.what}${plan ? ` Plan: ${plan.value}.` : " Plan: unknown."}${cost ? ` ${cost.label}: ${cost.value}.` : ""}${usage.length ? ` ${usage.join(", ")}.` : ""}${v.connected ? " Connected." : v.connectable ? " Connectable (owner can connect it in Settings)." : ""}`);
      }
      lines.push("", `Open questions for the owner: ${inv.openQuestions}. Pending approvals: ${inv.pendingActions}.`);
      lines.push("", "Facts carry a source: found in the code, from the connected account, from the vendor's current docs, estimated, or told by the owner. Call birdsi_vendor for one vendor's full facts with sources.");
      return text(lines.join("\n"));
    }),
  );

  server.registerTool(
    "birdsi_vendor",
    {
      title: "One vendor in full",
      description: "Everything known about one vendor: what it is, what this app uses it for, how it was found, every fact (plan, cost, usage, limits) with its source and evidence, links to pricing and docs, and where the code calls it.",
      inputSchema: { ...repoArg, slug: z.string().describe("Vendor slug from birdsi_inventory, for example supabase or vercel.") },
    },
    tool("that vendor", async (api, args: { repoId?: string | undefined; slug: string }) => {
      const { vendors } = (await api.vendors(await repoIdFrom(api, args.repoId))).data;
      const v = vendors.find((x) => x.slug === args.slug);
      if (!v) return { content: [{ type: "text", text: `No vendor called ${args.slug}. Call birdsi_inventory for the list.` }], isError: true };
      const lines = [`${v.name} (${v.category})`, v.what, ...(v.purpose ? [`Used here for: ${v.purpose}`] : []), `Found by: ${v.detectedBy.join(", ")}${v.packages.length ? `; packages ${v.packages.join(", ")}` : ""}${v.envVars.length ? `; env ${v.envVars.join(", ")}` : ""}`, ...(v.pricingUrl ? [`Pricing: ${v.pricingUrl}`] : []), ...(v.docsUrl ? [`Docs: ${v.docsUrl}`] : []), v.connected ? "Account connected." : v.connectable ? "Account not connected; the owner can connect it in Settings." : "No connector for this vendor yet.", ""];
      lines.push("Facts:");
      for (const f of v.facts) lines.push(`- ${f.label}: ${f.value}${f.limitNumeric !== null && f.numeric !== null ? ` (${Math.round((f.numeric / f.limitNumeric) * 100)}% of the limit)` : ""} [${f.source}${f.evidence.url ? `, ${f.evidence.url}` : ""}${f.evidence.note ? `, ${f.evidence.note}` : ""}]`);
      if (v.facts.length === 0) lines.push("- none yet");
      if (v.callSites.length > 0) lines.push("", "Used in:", ...v.callSites.slice(0, 15).map((c) => `- ${c.path}:${c.line}  ${c.excerpt}`));
      return text(lines.join("\n"));
    }),
  );

  server.registerTool(
    "birdsi_vision",
    {
      title: "The owner's vision",
      description: "The owner's vision: what the app is for and where it is going, in their own words, with when it was last updated. Weigh decisions against it. Only the owner writes it.",
      inputSchema: repoArg,
    },
    tool("that repository", async (api, args: { repoId?: string | undefined }) => {
      const { vision } = (await api.vision(await repoIdFrom(api, args.repoId))).data;
      return text(vision.text ? `${vision.text}\n\n(updated ${vision.updatedAt ?? "unknown"})` : "The owner has not written a vision yet. If you need it, ask with birdsi_ask_owner.");
    }),
  );

  server.registerTool(
    "birdsi_questions",
    {
      title: "Questions waiting for the owner",
      description: "Questions only the owner can answer, asked by birdsI or by agents, each with status, who asked, why, options and id. Answered ones include the answer. Check here before asking a question again.",
      inputSchema: { ...repoArg, status: z.enum(["open", "answered", "dismissed"]).optional() },
    },
    tool("the questions", async (api, args: { repoId?: string | undefined; status?: "open" | "answered" | "dismissed" | undefined }) => {
      const { questions } = (await api.questions(await repoIdFrom(api, args.repoId), args.status)).data;
      if (questions.length === 0) return text("No questions.");
      return text(questions.map((q) => `- [${q.status}] ${q.question}${q.vendorName ? ` (${q.vendorName})` : ""} asked by ${q.askedBy}. ${q.why}${q.options.length ? ` Options: ${q.options.join(", ")}.` : ""}${q.answer ? ` Answer: ${q.answer}` : ""} id: ${q.id}`).join("\n"));
    }),
  );

  server.registerTool(
    "birdsi_ask_owner",
    {
      title: "Ask the owner a question",
      description: "Adds a question to the owner's Questions queue, for what only a person can answer: a decision, a plan name, a number from a dashboard. Returns the question id at once. The owner answers in the dashboard or terminal; read the answer later with birdsi_questions. Ask only what you cannot find out yourself.",
      inputSchema: {
        ...repoArg,
        question: z.string().min(1).max(1000),
        why: z.string().min(1).max(1000).describe("Why you need it, in one or two plain sentences."),
        options: z.array(z.string().max(200)).max(8).optional().describe("When the answer is a choice, the options."),
        vendorSlug: z.string().max(80).optional(),
      },
    },
    tool("the question", async (api, args: { repoId?: string | undefined; question: string; why: string; options?: string[] | undefined; vendorSlug?: string | undefined }) => {
      const { question } = (await api.askOwner(await repoIdFrom(api, args.repoId), { question: args.question, why: args.why, ...(args.options ? { options: args.options } : {}), ...(args.vendorSlug ? { vendorSlug: args.vendorSlug } : {}) })).data;
      return text(`Queued for the owner (id ${question.id}). Check for the answer with birdsi_questions.`);
    }),
  );

  server.registerTool(
    "birdsi_request_action",
    {
      title: "Propose a command for approval",
      description:
        "Proposes a command to run on the owner's machine for something outside the code, for example a plan upgrade (stripe projects upgrade vercel) or a spend limit (stripe projects billing update --limit 50). Returns the request id and whether it waits for approval or was auto-approved by the repository's policy. Nothing runs until approved. Give the cost honestly. Follow it with birdsi_action_status.",
      inputSchema: {
        ...repoArg,
        title: z.string().min(1).max(200),
        reason: z.string().min(1).max(2000).describe("Why, with the evidence: which limit, which alert, which finding."),
        command: z.string().min(1).max(1000).describe("One plain command, no shell operators."),
        vendorSlug: z.string().max(80).optional(),
        estimatedMonthlyUsd: z.number().nonnegative().optional(),
        estimatedOnceUsd: z.number().nonnegative().optional(),
      },
    },
    tool("the request", async (api, args: { repoId?: string | undefined; title: string; reason: string; command: string; vendorSlug?: string | undefined; estimatedMonthlyUsd?: number | undefined; estimatedOnceUsd?: number | undefined }) => {
      const { action } = (await api.requestAction(await repoIdFrom(api, args.repoId), { title: args.title, reason: args.reason, command: args.command, ...(args.vendorSlug ? { vendorSlug: args.vendorSlug } : {}), ...(args.estimatedMonthlyUsd !== undefined ? { estimatedMonthlyUsd: args.estimatedMonthlyUsd } : {}), ...(args.estimatedOnceUsd !== undefined ? { estimatedOnceUsd: args.estimatedOnceUsd } : {}) })).data;
      return text(action.status === "approved" ? `Auto-approved within the owner's policy (id ${action.id}). It runs when the owner runs birdsi approvals run on their machine.` : `Waiting for the owner's approval (id ${action.id}). They decide in the dashboard or with birdsi approvals. Check with birdsi_action_status.`);
    }),
  );

  server.registerTool(
    "birdsi_action_status",
    {
      title: "Status of a proposed command",
      description: "Whether a proposed command is pending, approved, denied, executed, failed or expired, when it was decided, and its output once it ran.",
      inputSchema: { actionId: z.string() },
    },
    tool("that request", async (api, args: { actionId: string }) => {
      const { action } = (await api.action(args.actionId)).data;
      return text(`${action.title}: ${action.status}${action.autoApproved ? " (auto-approved)" : ""}.${action.decidedAt ? ` Decided ${action.decidedAt}.` : ""}${action.result ? `\nOutput:\n${action.result}` : ""}`);
    }),
  );

  server.registerTool(
    "birdsi_sync_vendors",
    {
      title: "Refresh vendors and limits",
      description: "Refreshes the vendor stage alone: reads connected accounts and current pricing pages again, updates alerts, and queues questions for what is still unknown. Returns at once; call birdsi_inventory in a minute for the result. Needs a finished scan.",
      inputSchema: repoArg,
    },
    tool("the sync", async (api, args: { repoId?: string | undefined }) => {
      await api.syncVendors(await repoIdFrom(api, args.repoId));
      return text("Refreshing vendors. Call birdsi_inventory again in a minute.");
    }),
  );

  server.registerTool(
    "birdsi_repos",
    {
      title: "Connected repositories",
      description: "Repositories on the owner's birdsI account, from GitHub or uploaded from a terminal, with the ids that birdsi_ask and repoId arguments need.",
      inputSchema: {},
    },
    tool("your repositories", async (api) => {
      const { repos } = (await api.repos()).data;
      if (repos.length === 0) return text("No repositories are connected to birdsI yet.");
      return text(repos.map((r) => `- ${r.fullName} (${r.private ? "private" : "public"}), id: ${r.id}`).join("\n"));
    }),
  );

  server.registerTool(
    "birdsi_ask",
    {
      title: "Ask about a repository",
      description: "Asks birdsI a question about a connected repository and returns a plain answer that cites the files and findings it used. Answers marked Judgment have no finding behind them.",
      inputSchema: { repoId: z.string().describe("Repository id from birdsi_repos."), question: z.string().min(1).max(4000) },
    },
    tool("that repository", async (api, args: { repoId: string; question: string }) => {
      const { message } = (await api.ask(args.repoId, args.question)).data;
      const lines = [message.content];
      if (message.citations.length > 0) {
        lines.push("", "Sources:");
        for (const c of message.citations) {
          const where = c.path ? `${c.path}${c.lineStart ? `:${c.lineStart}` : ""}` : c.findingId ? `finding ${c.findingId}` : "";
          lines.push(`- ${c.label}${where ? ` (${where})` : ""}`);
        }
      }
      if (message.judgment) lines.push("", "Judgment: the model's reading of the code, with no finding behind it. Verify before acting on it.");
      return text(lines.join("\n"));
    }),
  );

  return server;
}

export async function runMcpServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
