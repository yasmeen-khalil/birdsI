import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { Finding, ScanEventRecord, ScanKind, ScanResponse, ScanStatus } from "@birdsi/shared";
import { ApiClient, toCliError, type Result } from "../api";
import { CliError, EXIT, exitCodeForScan } from "../exit";
import { KIND_WORD, formatScanReport, glyphs, orderFindings, paint, plural, styleFor, wrap, type Style } from "../format";
import { displayName, readGitInfo } from "../git";
import { withInterrupt } from "../interrupt";
import { askYesNo } from "../prompt";
import { isInteractive, printJson, println, usageError } from "../output";
import { ScanProgress } from "../progress";
import { formatBytes } from "../snapshot";
import { VERSION } from "../version";
import { followScan, sendSnapshot, startScan, withRetry } from "../workflow";
import { runFix } from "./fix";

export interface ScanOptions {
  deep?: boolean;
  audit?: boolean;
  describe?: string;
  branch?: string;
  json?: boolean;
  fixPrompt?: boolean;
  ascii?: boolean;
}

export function scanKind(options: Pick<ScanOptions, "deep" | "audit">): ScanKind {
  return options.audit ? "audit" : options.deep ? "deep" : "light";
}

export async function scanCommand(pathArg: string | undefined, options: ScanOptions): Promise<number> {
  const json = Boolean(options.json);
  const style = styleFor(process.stdout, options);
  const g = glyphs(style);
  const say = (line = ""): void => {
    if (!json) println(line);
  };
  if (options.describe !== undefined && options.describe.length > 2000) {
    throw usageError("The description is longer than 2,000 characters.", "Keep --describe to a short paragraph.");
  }

  const root = resolve(pathArg ?? process.cwd());
  const rootInfo = await stat(root).catch(() => null);
  if (!rootInfo) throw usageError(`There is no folder at ${root}.`);
  if (!rootInfo.isDirectory()) throw usageError(`${root} is a file. Point birdsI at a folder.`);
  const kind = scanKind(options);
  const { api } = await ApiClient.fromEnvironment();
  api.requireAuth();

  let login: string;
  try {
    login = (await api.me()).data.login;
  } catch (error) {
    throw toCliError(error, "your account");
  }

  // 1 to 3: pack, upload, start.
  const git = await readGitInfo(root);
  const where = [displayName(root, git)];
  const branch = options.branch ?? git?.branch ?? undefined;
  if (branch) where.push(`on ${branch}`);
  if (git?.commitSha) where.push(`at ${git.commitSha.slice(0, 7)}`);
  say();
  say(`${paint.bold(style, `birdsI ${VERSION}`)}  ${where.join(" ")}`);
  say(`${KIND_WORD[kind]}. Signed in as ${login}.`);

  let scanId: string;
  let repoConnected = false;
  try {
    const sent = await sendSnapshot(api, root, {
      ...(options.branch ? { branch: options.branch } : {}),
      onStage: (stage) => {
        if (stage.stage !== "uploading") return;
        say(paint.dim(style, `Sending ${plural(stage.files, "file")}, ${formatBytes(stage.bytes)}. Files your .gitignore leaves out stay on this computer.`));
      },
    });
    if (sent.walk.tooLarge.length > 0) {
      say(paint.dim(style, `Left out ${plural(sent.walk.tooLarge.length, "file")} over 2 MB, for example ${sent.walk.tooLarge[0]}.`));
    }
    say();
    const scan = await startScan(api, {
      snapshotId: sent.snapshotId,
      kind,
      branch: sent.branch,
      describe: options.describe,
    });
    scanId = scan.id;
    repoConnected = scan.repoId !== null;
  } catch (error) {
    throw toCliError(error, "that");
  }

  // 4: follow progress, Ctrl+C stops the scan on the server.
  const progress = json ? null : new ScanProgress(process.stdout, style);
  let failure: string | null = null;
  const onEvents = (records: ScanEventRecord[]): void => {
    for (const r of records) if (r.event.type === "scan_failed") failure = r.event.error;
    progress?.handle(records);
  };
  const controller = new AbortController();
  let stopRequested = false;
  const ticker = progress && process.stdout.isTTY ? setInterval(() => progress.tick(), 1000) : null;
  let status: ScanStatus;
  try {
    status = await withInterrupt(
      (count) => {
        if (count === 1) {
          stopRequested = true;
          progress?.setStatus("Stopping the scan. Press Ctrl+C again to leave now.");
          if (!progress && !json) println("Stopping the scan.");
          api.stopScan(scanId).catch(() => undefined);
          // If the server does not confirm within 20 seconds, leave anyway.
          setTimeout(() => controller.abort(), 20_000).unref();
        } else {
          controller.abort();
        }
      },
      () => followScan(api, scanId, { onEvents, signal: controller.signal }),
    );
  } catch (error) {
    progress?.finish("running");
    throw toCliError(error, "the scan");
  } finally {
    if (ticker) clearInterval(ticker);
  }
  if (controller.signal.aborted && status !== "stopped") status = stopRequested ? "stopped" : status;
  progress?.finish(status === "done" || status === "failed" || status === "stopped" ? status : "running");

  // 5 and 6: the result.
  let result: Result<ScanResponse> | null = null;
  try {
    result = await withRetry(() => api.scan(scanId));
  } catch (error) {
    if (json || status === "done") throw toCliError(error, "the scan result");
  }
  if (json && result) printJson(result.raw);

  if (status === "stopped") {
    say();
    say(`${paint.fail(style, g.failed)} You stopped the scan. Nothing in your repository changed.`);
    return EXIT.stopped;
  }
  if (status === "failed") {
    const message = failure ?? result?.data.scan.error ?? "birdsI did not say why.";
    const step = progress?.currentStepNumber;
    say();
    say(`  ${paint.fail(style, g.failed)} ${paint.bold(style, step ? `Scan stopped at step ${step}.` : "The scan could not finish.")}`);
    say(wrap(message, style, "    "));
    say();
    say(paint.dim(style, `  Nothing in your repository changed. Exit code ${EXIT.failed}.`));
    return EXIT.failed;
  }
  if (status !== "done" || !result) {
    throw new CliError("birdsI stopped answering before the scan finished.", EXIT.failed, `The scan id is ${scanId}. Try: birdsi findings ${scanId}`);
  }

  const { scan, findings } = result.data;
  const exitCode = exitCodeForScan(scan.status, findings);
  if (json) return exitCode;

  say();
  say(formatScanReport(scan, findings, style));

  const wantsPrompt = options.fixPrompt !== false && isInteractive();
  if (wantsPrompt) {
    const stopped = await walkFixes(api, orderFindings(findings), { style, dir: root, repoConnected });
    if (stopped) return EXIT.stopped;
  } else if (findings.some((f) => f.actionKind === "fix" && f.status === "open")) {
    say();
    say(paint.dim(style, "Start any fix with: birdsi fix <number>"));
  }
  return exitCode;
}

/**
 * One question per fixable finding, in severity order. Enter alone means
 * no. Returns true when the user pressed Ctrl+C to leave.
 */
async function walkFixes(
  api: ApiClient,
  ordered: Finding[],
  options: { style: Style; dir: string; repoConnected: boolean },
): Promise<boolean> {
  const { style } = options;
  const fixable = ordered.filter((f) => f.actionKind === "fix" && f.status === "open");
  for (const [i, finding] of fixable.entries()) {
    println();
    println(paint.bold(style, `Fix ${i + 1} of ${fixable.length}: ${finding.title}`));
    if (finding.fixPlan) {
      println(wrap(`- ${finding.fixPlan.summary}`, style, "  "));
      if (finding.fixPlan.paths.length > 0) println(wrap(`- Changes ${finding.fixPlan.paths.join(", ")}`, style, "  "));
    }
    const question =
      finding.repoId !== null || options.repoConnected
        ? "Open a pull request for this fix? [y/N]"
        : "Make this fix in your local files? [y/N]";
    println();
    const yes = await askYesNo(paint.accent(style, question));
    if (yes === null) return true;
    if (!yes) {
      println(paint.dim(style, "  Skipped."));
      continue;
    }
    try {
      const outcome = await runFix(api, finding, { style, apply: true, dir: options.dir });
      if (outcome.kind === "interrupted") return true;
    } catch (error) {
      const cli = toCliError(error, "that fix");
      if (cli.exitCode === EXIT.notSignedIn) throw cli;
      println(`  ${paint.fail(style, glyphs(style).failed)} ${cli.message}`);
      if (cli.hint) println(paint.dim(style, `    ${cli.hint}`));
    }
  }
  return false;
}
