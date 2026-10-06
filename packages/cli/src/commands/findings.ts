import type { Repo } from "@birdsi/shared";
import { ApiClient, toCliError } from "../api";
import { readConfig } from "../config";
import { CliError, EXIT } from "../exit";
import {
  KIND_WORD,
  countsLine,
  formatAudit,
  formatFindingDetail,
  formatFindingsList,
  formatRepos,
  paint,
  styleFor,
  wrap,
} from "../format";
import { askYesNo } from "../prompt";
import { isInteractive, printJson, println, usageError } from "../output";
import { resolveFindingRef } from "../workflow";

interface PrintOptions {
  json?: boolean;
  ascii?: boolean;
}

export async function findingsCommand(scanIdArg: string | undefined, options: PrintOptions): Promise<number> {
  const style = styleFor(process.stdout, options);
  const { api } = await ApiClient.fromEnvironment();
  api.requireAuth();
  const scanId = scanIdArg ?? (await readConfig()).lastScanId;
  if (!scanId) throw usageError("Which scan? Pass a scan id.", "Example: birdsi findings scan_123");
  let result;
  try {
    result = await api.scan(scanId);
  } catch (error) {
    throw toCliError(error, "that scan");
  }
  if (options.json) {
    printJson(result.raw);
    return EXIT.ok;
  }
  const { scan, findings } = result.data;
  const active = findings.filter((f) => f.status !== "dismissed" && f.status !== "fixed");
  const fixable = active.filter((f) => f.actionKind === "fix").length;
  const statusWord =
    scan.status === "done" ? "finished" : scan.status === "running" || scan.status === "queued" ? "still running" : scan.status;
  println(paint.dim(style, `${KIND_WORD[scan.kind]} ${scan.id}, ${statusWord}${scan.branch ? `, ${scan.branch}` : ""}`));
  println(paint.bold(style, countsLine(active.length, fixable, active.length - fixable)));
  if (scan.summary?.headline) println(wrap(scan.summary.headline, style, ""));
  if (scan.audit) {
    println();
    println(formatAudit(scan.audit, style));
  }
  println();
  println(formatFindingsList(findings, style));
  return EXIT.ok;
}

export async function explainCommand(ref: string, options: PrintOptions): Promise<number> {
  const style = styleFor(process.stdout, options);
  const { api } = await ApiClient.fromEnvironment();
  api.requireAuth();
  try {
    const { findingId, number } = await resolveFindingRef(api, ref);
    const result = await api.finding(findingId);
    if (options.json) printJson(result.raw);
    else println(formatFindingDetail(result.data.finding, result.data.fix, style, number));
    return EXIT.ok;
  } catch (error) {
    throw toCliError(error, "that finding");
  }
}

export async function dismissCommand(ref: string, options: { yes?: boolean; json?: boolean }): Promise<number> {
  const style = styleFor(process.stdout);
  const { api } = await ApiClient.fromEnvironment();
  api.requireAuth();
  try {
    const { findingId } = await resolveFindingRef(api, ref);
    const { finding } = (await api.finding(findingId)).data;
    if (!options.yes) {
      if (!isInteractive()) throw usageError("Dismissing needs a yes.", "Add --yes to dismiss without a question.");
      println(`${paint.bold(style, finding.title)}`);
      const yes = await askYesNo(paint.fail(style, "Dismiss this finding? It stops counting in later scans. [y/N]"));
      if (!yes) {
        println("Kept.");
        return EXIT.ok;
      }
    }
    const result = await api.dismiss(findingId);
    if (options.json) printJson(result.raw);
    else println("Dismissed.");
    return EXIT.ok;
  } catch (error) {
    throw toCliError(error, "that finding");
  }
}

export async function reposCommand(options: PrintOptions): Promise<number> {
  const style = styleFor(process.stdout, options);
  const { api } = await ApiClient.fromEnvironment();
  api.requireAuth();
  try {
    const result = await api.repos();
    if (options.json) printJson(result.raw);
    else println(formatRepos(result.data.repos, style));
    return EXIT.ok;
  } catch (error) {
    throw toCliError(error, "your repositories");
  }
}

/** A repository reference is its id or its owner/name. */
export function matchRepo(repos: readonly Repo[], ref: string): Repo | undefined {
  const lower = ref.toLowerCase();
  return repos.find((r) => r.id === ref) ?? repos.find((r) => r.fullName.toLowerCase() === lower);
}

export async function askCommand(repoRef: string, questionWords: string[], options: PrintOptions): Promise<number> {
  const style = styleFor(process.stdout, options);
  const question = questionWords.join(" ").trim();
  if (question === "") throw usageError("What is the question?", 'Example: birdsi ask owner/app "Where do we check who is signed in?"');
  const { api } = await ApiClient.fromEnvironment();
  api.requireAuth();
  try {
    let repoId = repoRef;
    if (repoRef.includes("/")) {
      const repo = matchRepo((await api.repos()).data.repos, repoRef);
      if (!repo) {
        throw new CliError(`${repoRef} is not connected to birdsI.`, EXIT.failed, "See connected repositories: birdsi repos");
      }
      repoId = repo.id;
    }
    const result = await api.ask(repoId, question);
    if (options.json) {
      printJson(result.raw);
      return EXIT.ok;
    }
    const { message } = result.data;
    println(wrap(message.content, style, ""));
    if (message.citations.length > 0) {
      println();
      for (const c of message.citations) {
        const where = c.path ? `${c.path}${c.lineStart ? `:${c.lineStart}` : ""}` : c.findingId ? `finding ${c.findingId}` : "";
        println(paint.dim(style, `  ${c.label}${where && where !== c.label ? `  ${where}` : ""}`));
      }
    }
    if (message.judgment) {
      println();
      println(paint.dim(style, "Judgment: this answer is birdsI's reading of the code, with no finding behind it. Worth checking."));
    }
    return EXIT.ok;
  } catch (error) {
    throw toCliError(error, "that repository");
  }
}

/** Says the finding is fixed in the code; the next scan is the judge. */
export async function fixedCommand(ref: string, options: { note?: string; json?: boolean }): Promise<number> {
  const { api } = await ApiClient.fromEnvironment();
  api.requireAuth();
  try {
    const { findingId } = await resolveFindingRef(api, ref);
    const result = await api.markFixed(findingId, options.note);
    if (options.json) printJson(result.raw);
    else println("Marked fixed. The next scan confirms it, or reopens it.");
    return EXIT.ok;
  } catch (error) {
    throw toCliError(error, "that finding");
  }
}
