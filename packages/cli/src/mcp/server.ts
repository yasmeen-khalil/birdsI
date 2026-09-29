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
      if (!api.signedIn) {
        return {
          content: [{ type: "text", text: "Not signed in to birdsI. Run birdsi login in a terminal, or set BIRDSI_TOKEN in this server's environment." }],
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
    lines.push("", "Confidence: Proven means a tool or rule proved it. Doc-verified means checked against a current official document. Judgment means the model's reading, worth checking.");
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
      title: "Scan a local codebase",
      description:
        "Uploads a snapshot of a local folder (honouring .gitignore) to birdsI and scans it for security holes, vulnerable dependencies, contradictions and gaps, checked against current docs. By default waits for the result and returns a summary with the top findings and their ids.",
      inputSchema: {
        path: z.string().describe("Absolute path of the folder to scan."),
        kind: ScanKind.optional().describe("light (default, fast), deep (reads all the code), or audit (pre-launch audit, the deepest)."),
        describe: z.string().max(2000).optional().describe("What the app does, in a sentence or two. Sharpens the scan."),
        wait: z.boolean().optional().describe("Wait for the scan to finish (default true). With false, returns the scan id at once."),
      },
    },
    tool("that folder", async (api, args: { path: string; kind?: z.infer<typeof ScanKind> | undefined; describe?: string | undefined; wait?: boolean | undefined }) => {
      const root = isAbsolute(args.path) ? args.path : resolve(process.cwd(), args.path);
      const sent = await sendSnapshot(api, root);
      const kind = args.kind ?? "light";
      const scan = await startScan(api, { snapshotId: sent.snapshotId, kind, branch: sent.branch, describe: args.describe });
      if (args.wait === false) {
        return text(`Started ${KIND_WORD[kind].toLowerCase()} ${scan.id} on ${sent.walk.files.length} files. Check it with birdsi_scan_status.`);
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
      description: "Status and progress of a birdsI scan; the summary and top findings once it is done.",
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
      description: "Findings of a scan, optionally filtered by severity, confidence, or who acts (fix: birdsI can fix it; steps: the developer must act).",
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
      description: "One finding in full: what is wrong, why it matters, the evidence, the steps or fix plan, and what its confidence class means.",
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
        "Has birdsI write and sandbox-test a fix for a finding it can fix. Returns the pull request link for repositories connected through the GitHub App, otherwise the patch. With apply and a local path, applies the patch there with git apply.",
      inputSchema: {
        findingId: z.string(),
        apply: z.boolean().optional().describe("Apply the patch to the local folder at path."),
        path: z.string().optional().describe("Absolute path of the local folder to apply the patch in."),
      },
    },
    tool("that finding", async (api, args: { findingId: string; apply?: boolean | undefined; path?: string | undefined }) => {
      const { finding } = (await api.finding(args.findingId)).data;
      if (finding.actionKind !== "fix") {
        return { content: [{ type: "text", text: "birdsI cannot fix this finding itself. Call birdsi_finding for the steps the developer must take." }], isError: true };
      }
      if (args.apply && !args.path) {
        return { content: [{ type: "text", text: "To apply the fix, pass path: the local folder to change." }], isError: true };
      }
      const started = (await api.startFix(finding.id)).data.fix;
      const fix = await waitForFix(api, started, { expectPr: finding.repoId !== null });
      const lines = [fixStatusLine(fix)];
      const result = sandboxResult(fix);
      if (result) lines.push(`Sandbox: ${result}`);
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
        lines.push("", "The developer still needs to:", ...finding.fixPlan.followUp.map((f) => `- ${f}`));
      }
      return text(lines.join("\n"));
    }),
  );

  server.registerTool(
    "birdsi_repos",
    {
      title: "Connected repositories",
      description: "Repositories connected to birdsI through the GitHub App, with the ids birdsi_ask needs.",
      inputSchema: {},
    },
    tool("your repositories", async (api) => {
      const { repos } = (await api.repos()).data;
      if (repos.length === 0) return text("No repositories are connected to birdsI.");
      return text(repos.map((r) => `- ${r.fullName} (${r.private ? "private" : "public"}), id: ${r.id}`).join("\n"));
    }),
  );

  server.registerTool(
    "birdsi_ask",
    {
      title: "Ask about a repository",
      description: "Asks birdsI a question about a connected repository. Answers cite files and findings.",
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
      if (message.judgment) lines.push("", "Judgment: the model's reading of the code, with no finding behind it. Worth checking.");
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
