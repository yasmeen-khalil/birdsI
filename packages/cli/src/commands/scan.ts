import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { ScanEventRecord, ScanResponse, ScanStatus } from "@birdsi/shared";
import { ApiClient, toCliError, type Result } from "../api";
import { CliError, EXIT, exitCodeForScan } from "../exit";
import { formatScanReport, glyphs, paint, plural, styleFor, wrap } from "../format";
import { displayName, readGitInfo } from "../git";
import { withInterrupt } from "../interrupt";
import { printJson, println, usageError } from "../output";
import { ScanProgress } from "../progress";
import { formatBytes } from "../snapshot";
import { VERSION } from "../version";
import { followScan, sendSnapshot, startScan, withRetry } from "../workflow";
import { openBrowser } from "./auth";
import { formatNeedsYou } from "./ops";
import { scannerNote } from "@birdsi/shared";

export interface ScanOptions {
  /** Open the app's page in the browser once the map starts. */
  open?: boolean;
  branch?: string;
  json?: boolean;
  ascii?: boolean;
}

/**
 * Maps the app in a folder: uploads a snapshot (env files and keys never
 * leave the computer), follows the map, prints what it found and what needs
 * the owner. The upload is deleted on birdsI as soon as the map has run.
 */
export async function scanCommand(pathArg: string | undefined, options: ScanOptions): Promise<number> {
  const json = Boolean(options.json);
  const style = styleFor(process.stdout, options);
  const g = glyphs(style);
  const say = (line = ""): void => {
    if (!json) println(line);
  };

  const root = resolve(pathArg ?? process.cwd());
  const rootInfo = await stat(root).catch(() => null);
  if (!rootInfo) throw usageError(`There is no folder at ${root}.`);
  if (!rootInfo.isDirectory()) throw usageError(`${root} is a file. Point birdsI at a folder.`);
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
  say(`Map of the code. Signed in as ${login}.`);

  let scanId: string;
  let repoId: string | null = null;
  let dashboardUrl: string | null = null;
  try {
    const sent = await sendSnapshot(api, root, {
      ...(options.branch ? { branch: options.branch } : {}),
      onStage: (stage) => {
        if (stage.stage !== "uploading") return;
        say(paint.dim(style, `Sending ${plural(stage.files, "file")}, ${formatBytes(stage.bytes)}. Files your .gitignore leaves out stay on this computer.`));
      },
    });
    if (sent.walk.tooLarge.length > 0) {
      say(paint.dim(style, `Left out ${plural(sent.walk.tooLarge.length, "file")} over the size limit, for example ${sent.walk.tooLarge[0]}.`));
    }
    say();
    const scan = await startScan(api, { snapshotId: sent.snapshotId, branch: sent.branch });
    scanId = scan.id;
    repoId = scan.repoId;
    dashboardUrl = scan.dashboardUrl ?? null;
    if (dashboardUrl) {
      say(paint.dim(style, `The app's page: ${dashboardUrl}`));
      if (options.open && process.stdout.isTTY) openBrowser(dashboardUrl);
    }
  } catch (error) {
    throw toCliError(error, "that");
  }

  // 4: follow progress, Ctrl+C stops the map on the server.
  const progress = json ? null : new ScanProgress(process.stdout, style);
  let failure: string | null = null;
  const onEvents = (records: ScanEventRecord[]): void => {
    for (const r of records) if (r.event.type === "scan_failed") failure = r.event.error;
    progress?.handle(records);
  };
  const controller = new AbortController();
  let stopRequested = false;
  let scannerLine: string | null = null;
  const ticker = progress && process.stdout.isTTY ? setInterval(() => progress.tick(), 1000) : null;
  let status: ScanStatus;
  try {
    status = await withInterrupt(
      (count) => {
        if (count === 1) {
          stopRequested = true;
          progress?.setStatus("Stopping the map. Press Ctrl+C again to leave now.");
          if (!progress && !json) println("Stopping the map.");
          api.stopScan(scanId).catch(() => undefined);
          // If the server does not confirm within 20 seconds, leave anyway.
          setTimeout(() => controller.abort(), 20_000).unref();
        } else {
          controller.abort();
        }
      },
      () =>
        followScan(api, scanId, {
          onEvents,
          onPresence: (workerSeenAt, status) => {
            if (stopRequested || !progress) return;
            const note = status === "queued" ? scannerNote(workerSeenAt) : null;
            if (note !== scannerLine) {
              scannerLine = note;
              progress.setStatus(note);
            }
          },
          signal: controller.signal,
        }),
    );
  } catch (error) {
    progress?.finish("running");
    throw toCliError(error, "the map");
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
    if (json || status === "done") throw toCliError(error, "the map's result");
  }
  if (json && result) printJson(result.raw);

  if (status === "stopped") {
    say();
    say(`${paint.fail(style, g.failed)} You stopped the map. Nothing in your repository changed.`);
    return EXIT.stopped;
  }
  if (status === "failed") {
    const message = failure ?? result?.data.scan.error ?? "No reason was reported.";
    const step = progress?.currentStepNumber;
    say();
    say(`  ${paint.fail(style, g.failed)} ${paint.bold(style, step ? `The map stopped at step ${step}.` : "The map could not finish.")}`);
    say(wrap(message, style, "    "));
    say();
    say(paint.dim(style, `  Nothing in your repository changed. Exit code ${EXIT.failed}.`));
    return EXIT.failed;
  }
  if (status !== "done" || !result) {
    throw new CliError("birdsI stopped answering before the map finished.", EXIT.failed, `The map's id is ${scanId}. Try: birdsi findings ${scanId}`);
  }

  const { scan, findings } = result.data;
  const exitCode = exitCodeForScan(scan.status, findings);
  if (json) return exitCode;

  say();
  say(formatScanReport(scan, findings, style));

  // What needs the owner outside the code: limits, questions, approvals.
  if (repoId) {
    try {
      const inv = (await api.inventory(repoId)).data;
      const needs = formatNeedsYou(inv.openQuestions, inv.pendingActions, inv.alerts, dashboardUrl, style);
      if (needs) {
        say();
        say(needs);
      }
    } catch {
      // Vendors may still be syncing. The dashboard shows them when ready.
    }
  }
  return exitCode;
}
