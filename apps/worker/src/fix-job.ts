import { findingById, fixById, recordUsage, repoWithInstallation, scanById, setFindingStatus, toFinding, updateFix, type JobRow } from "@birdsi/db";
import { ecosystemHintFor, generateFix, GitHubSource, SandboxRunner, type EngineConfig, type Snapshot } from "@birdsi/engine";
import { resolveSnapshot } from "./scan-job";
import { assertWithinSpendCaps, SpendCapError, spendHook } from "./spend";

/**
 * Produces a fix for one finding, tests it in a sandbox, and opens a pull
 * request when the repository came through the GitHub App. For uploaded
 * snapshots the tested patch is stored for the CLI to apply locally.
 */
export async function runFixJob(config: EngineConfig, job: JobRow, heartbeat: () => Promise<void>): Promise<void> {
  const fixId = String(job.payload["fixId"]);
  const fix = await fixById(fixId);
  if (!fix) throw new Error(`fix ${fixId} not found`);
  if (fix.status === "pr_open") return;
  const findingRow = await findingById(fix.finding_id);
  if (!findingRow) throw new Error("finding not found");
  const finding = toFinding(findingRow);
  const scan = await scanById(finding.scanId);
  if (!scan) throw new Error("scan not found");
  try {
    await assertWithinSpendCaps(scan.owner_user_id, { fresh: true });
  } catch (error) {
    if (!(error instanceof SpendCapError)) throw error;
    await updateFix(fixId, { status: "failed", error: error.message });
    return;
  }
  const spend = spendHook(scan.owner_user_id);

  const ticker = setInterval(() => void heartbeat().catch(() => {}), 15_000);
  let snapshot: Snapshot | null = null;
  try {
    snapshot = await resolveSnapshot(config, scan.repo_id, scan.snapshot_id, scan.branch, scan.source);
    await updateFix(fixId, { status: "proposed", error: null });
    const generated = await generateFix(config, {
      finding,
      snapshot,
      beforeCall: spend.beforeCall,
      onUsage: (u) => recordUsage({ ownerUserId: scan.owner_user_id, scanId: scan.id, fixId, purpose: u.purpose, model: u.model, inputTokens: u.inputTokens, outputTokens: u.outputTokens, costMicrodollars: u.costMicrodollars }),
    });
    await updateFix(fixId, { summary: generated.summary, patch: generated.patch, files: generated.files, verify_command: generated.verifyCommand, follow_up: generated.followUp, status: "testing" });

    // Test in a sandbox when one is configured and the project has a verify command.
    let testLog = "";
    let tested = false;
    if (SandboxRunner.isConfigured(config) && generated.verifyCommand) {
      const runner = new SandboxRunner(config);
      const run = await runner.run({ snapshot, files: generated.files, command: generated.verifyCommand, ecosystemHint: await ecosystemHintFor(snapshot.root) });
      testLog = [`$ ${run.command}`, run.stdout, run.stderr, `exit code ${run.exitCode ?? "unknown"} after ${Math.round(run.durationMs / 1000)}s`].filter(Boolean).join("\n");
      tested = true;
      if (!run.ok && !run.skipped) {
        await updateFix(fixId, { status: "failed", test_log: testLog, error: "The change did not pass the project's own checks in the sandbox, so no pull request was opened." });
        return;
      }
    } else {
      testLog = SandboxRunner.isConfigured(config)
        ? "No test or typecheck command was found in the project, so the change was not run in a sandbox."
        : "Sandbox testing is not configured on this server, so the change was not run before the pull request.";
    }
    await updateFix(fixId, { status: "tested", test_log: testLog });

    // Open the pull request when the code came through the GitHub App.
    if (scan.repo_id && scan.source !== "demo") {
      const { repo, installation } = await repoWithInstallation(scan.repo_id);
      if (installation && !installation.removed_at && GitHubSource.isConfigured(config)) {
        const github = new GitHubSource(config);
        const [owner, name] = repo.full_name.split("/") as [string, string];
        const ref = { owner, name, installationId: installation.github_installation_id };
        const baseBranch = scan.branch ?? repo.default_branch;
        const baseSha = snapshot.commitSha ?? (await github.resolveHead(ref, baseBranch));
        const branchName = `birdsi/fix-${finding.id.slice(0, 8)}`;
        const body = [
          `## ${finding.title}`,
          "",
          finding.explanation,
          "",
          `**Change:** ${generated.summary}`,
          "",
          `**Confidence:** ${confidenceLabel(finding.confidence)}`,
          tested ? `**Sandbox check:** ${generated.verifyCommand} passed.` : `**Sandbox check:** not run (${testLog}).`,
          generated.followUp.length > 0 ? `\n**After merging:**\n${generated.followUp.map((s) => `- ${s}`).join("\n")}` : "",
          "",
          "Opened by birdsI. Review the diff before merging.",
        ].join("\n");
        const pr = await github.openPullRequest(ref, {
          baseBranch,
          baseSha,
          branchName,
          title: `Fix: ${finding.title}`.slice(0, 120),
          body,
          commitMessage: `Fix: ${finding.title}`.slice(0, 72),
          files: generated.files.map((f) => ({ path: f.path, content: f.content })),
        });
        await updateFix(fixId, { status: "pr_open", pr_number: pr.number, pr_url: pr.url, branch_name: branchName });
        await setFindingStatus(finding.id, finding.repoId, finding.key, "pr_open");
        return;
      }
    }
    // No GitHub App path: the tested patch is the deliverable (CLI applies it locally).
    await updateFix(fixId, { status: "tested" });
  } catch (error) {
    const message = spend.refusal() ?? (error instanceof Error ? error.message : String(error));
    await updateFix(fixId, { status: "failed", error: message.slice(0, 1000) });
    throw error;
  } finally {
    clearInterval(ticker);
    await snapshot?.cleanup();
  }
}

function confidenceLabel(c: string): string {
  return c === "proven" ? "Proven" : c === "doc_verified" ? "Doc-verified" : "Judgment";
}
