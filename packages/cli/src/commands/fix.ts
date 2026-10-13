import type { Finding, Fix } from "@birdsi/shared";
import { ApiClient, toCliError } from "../api";
import { CliError, EXIT } from "../exit";
import { fixStatusLine, glyphs, paint, sandboxRan, sandboxResult, styleFor, wrap, type Style } from "../format";
import { withInterrupt } from "../interrupt";
import { printJson, println, StatusLine } from "../output";
import { applyPatchLocally, manualApplyCommand } from "../patch";
import { expectsPullRequest, resolveFindingRef, waitForFix } from "../workflow";

export type FixOutcome =
  | { kind: "pr"; fix: Fix }
  | { kind: "applied"; fix: Fix; files: string[] }
  | { kind: "saved"; fix: Fix; patchFile: string }
  | { kind: "patch"; fix: Fix }
  | { kind: "failed"; fix: Fix }
  | { kind: "interrupted"; fix: Fix };

/**
 * Starts a fix, waits for the sandbox when one is set up, and reports the
 * result. With a pull request, prints its link. With only a patch, applies
 * it in `dir` (when apply is true) or leaves it for the caller to print.
 * `expectPr` says whether to wait for a pull request, and is looked up from
 * the repository when left out.
 */
export async function runFix(
  api: ApiClient,
  finding: Pick<Finding, "id" | "repoId" | "fixPlan">,
  options: { style: Style; apply: boolean; dir: string; quiet?: boolean; expectPr?: boolean },
): Promise<FixOutcome> {
  const { style } = options;
  const g = glyphs(style);
  const say = (line: string): void => {
    if (!options.quiet) println(line);
  };
  const status = new StatusLine();
  const show = (fix: Fix): void => {
    if (!options.quiet && (fix.status === "proposed" || fix.status === "testing")) status.set(`  ${paint.accent(style, g.running)} ${fixStatusLine(fix)}`);
  };

  let started: Fix;
  try {
    started = (await api.startFix(finding.id)).data.fix;
  } catch (error) {
    throw toCliError(error, "that finding");
  }

  const expectPr = options.expectPr ?? (await expectsPullRequest(api, finding.repoId));
  const controller = new AbortController();
  let interrupted = false;
  let fix: Fix;
  try {
    fix = await withInterrupt(
      () => {
        interrupted = true;
        controller.abort();
      },
      () => waitForFix(api, started, { onUpdate: show, signal: controller.signal, expectPr }),
    );
  } catch (error) {
    status.clear();
    throw toCliError(error, "that fix");
  }
  status.clear();

  if (interrupted) {
    say(paint.dim(style, `  The fix keeps running on birdsI. Check on it later: birdsi fix ${finding.id}`));
    return { kind: "interrupted", fix };
  }

  const result = sandboxResult(fix);
  if (fix.status === "failed") {
    say(`  ${paint.fail(style, g.failed)} The fix did not go through${fix.error ? `: ${fix.error}` : "."}`);
    if (result && result !== fix.error) say(paint.dim(style, `    ${result}`));
    say(paint.dim(style, "    Nothing in your files changed."));
    return { kind: "failed", fix };
  }
  if (sandboxRan(fix)) say(`  ${paint.ok(style, g.done)} Tested on a separate copy${result ? `: ${result}` : "."}`);
  else say(`  ${paint.dim(style, g.pending)} ${result ?? "The change was not run on a separate copy."}`);

  const followUp = (): void => {
    const items = finding.fixPlan?.followUp ?? [];
    items.forEach((item, i) => say(wrap(`${i === 0 ? "Next:" : "Then:"} ${item}`, style, "  ")));
  };

  if (fix.prUrl) {
    say(`  ${paint.ok(style, g.done)} Opened pull request${fix.prNumber ? ` #${fix.prNumber}` : ""}`);
    say(`    ${fix.prUrl}`);
    followUp();
    return { kind: "pr", fix };
  }
  if (!fix.patch) {
    throw new CliError("The fix finished without a pull request or a change to apply.", EXIT.failed, `Check on it: birdsi fix ${finding.id}`);
  }
  if (!options.apply) return { kind: "patch", fix };

  const applied = await applyPatchLocally(options.dir, fix.patch, fix.id);
  if (applied.applied) {
    say(`  ${paint.ok(style, g.done)} Changed ${applied.files.length === 1 ? "1 file" : `${applied.files.length} files`} in your folder:`);
    for (const file of applied.files) say(`    ${file}`);
    say(
      paint.dim(
        style,
        applied.method === "3way"
          ? "    The change is staged in git. Review it with git diff --staged before you commit."
          : "    Review the change before you commit it.",
      ),
    );
    followUp();
    return { kind: "applied", fix, files: applied.files };
  }
  say(`  ${paint.fail(style, g.failed)} birdsI could not apply the change to your files${applied.reason ? `: ${applied.reason}` : "."}`);
  say(`    The change is saved in ${applied.patchFile}`);
  say(`    Apply it yourself with: ${paint.bold(style, manualApplyCommand(applied.patchFile, fix.patch))}`);
  followUp();
  return { kind: "saved", fix, patchFile: applied.patchFile };
}

export async function fixCommand(
  ref: string,
  options: { apply?: boolean; path?: string; json?: boolean; ascii?: boolean },
): Promise<number> {
  const style = styleFor(process.stdout, options);
  const { api } = await ApiClient.fromEnvironment();
  api.requireAuth();
  let finding: Finding;
  try {
    const { findingId } = await resolveFindingRef(api, ref);
    finding = (await api.finding(findingId)).data.finding;
  } catch (error) {
    throw toCliError(error, "that finding");
  }
  if (finding.actionKind !== "fix") {
    throw new CliError(
      "birdsI cannot fix this one itself. It needs you to follow the steps.",
      EXIT.usage,
      `See the steps: birdsi explain ${finding.id}`,
    );
  }
  if (!options.json) {
    println(paint.bold(style, `Fix: ${finding.title}`));
    if (finding.fixPlan) println(wrap(`- ${finding.fixPlan.summary}`, style, "  "));
  }
  const outcome = await runFix(api, finding, {
    style,
    apply: Boolean(options.apply),
    dir: options.path ?? process.cwd(),
    quiet: Boolean(options.json),
  });
  if (options.json) {
    try {
      printJson((await api.fix(outcome.fix.id)).raw);
    } catch (error) {
      throw toCliError(error, "that fix");
    }
  } else if (outcome.kind === "patch" && outcome.fix.patch) {
    println(paint.dim(style, "  The change, as a patch. Apply it in your folder with birdsi fix --apply, or with git apply."));
    println();
    process.stdout.write(outcome.fix.patch.endsWith("\n") ? outcome.fix.patch : `${outcome.fix.patch}\n`);
  }
  switch (outcome.kind) {
    case "failed":
      return EXIT.failed;
    case "interrupted":
      return EXIT.stopped;
    case "saved":
      return EXIT.failed;
    default:
      return EXIT.ok;
  }
}
