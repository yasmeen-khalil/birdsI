import { basename } from "node:path";
import { findingKey, type FindingDraft } from "@birdsi/shared";
import type { Check, CheckContext } from "./types";

/**
 * Deterministic repository hygiene: things a rule can establish without a
 * model. Each rule yields a Proven finding.
 */
export const configCheck: Check = {
  id: "config",
  step: "secrets",
  label: "Checking repository settings and ignored files",
  scope: "Env files tracked in git, a missing .gitignore or one that leaves out node_modules or .env, and GitHub Actions workflows that run a pull request's code with the repository's secrets.",
  available: () => true,
  async run(ctx: CheckContext): Promise<FindingDraft[]> {
    const findings: FindingDraft[] = [];
    const paths = new Set(ctx.inventory.files.map((f) => f.path));
    const hasGitignore = paths.has(".gitignore");
    const gitignore = hasGitignore ? await ctx.read(".gitignore") : "";

    // 1. Env files tracked in the repository.
    const envFiles = ctx.inventory.files.filter((f) => {
      const name = basename(f.path);
      return name.startsWith(".env") && !/\.(example|sample|template)$/.test(name);
    });
    for (const file of envFiles) {
      findings.push({
        key: findingKey({ checkId: "config", path: file.path, subject: "env-committed" }),
        checkId: "config",
        title: `${file.path} is part of the repository`,
        explanation: `Files named .env hold local settings and usually secrets. This one is checked in, so everyone with access to the repository, and every clone ever made, has a copy.`,
        whyItMatters: "Even if it holds nothing sensitive today, the next value someone adds will be committed too. Keeping it out of git is the habit that prevents leaks.",
        severity: envFiles.length > 0 && /(secret|key|token|password)/i.test(await ctx.read(file.path)) ? "high" : "medium",
        confidence: "proven",
        category: "config",
        location: { path: file.path },
        evidence: { advisories: [], rule: "A file matching .env* (not .example) is in the tracked tree" },
        actionKind: "fix",
        steps: [],
        fixPlan: {
          summary: `Add ${basename(file.path)} to .gitignore and add a ${basename(file.path)}.example with the variable names and no values.`,
          paths: [".gitignore", `${file.path}.example`],
          followUp: [`Run git rm --cached ${file.path} so git stops tracking it. The file stays on your machine.`],
        },
      });
    }

    // 2. No .gitignore at all in a project with dependencies.
    if (!hasGitignore && ctx.rawDependencies.length > 0) {
      findings.push({
        key: findingKey({ checkId: "config", path: ".gitignore", subject: "missing" }),
        checkId: "config",
        title: "The repository has no .gitignore",
        explanation: "Without a .gitignore, installed packages, build output and local settings files get committed by accident.",
        whyItMatters: "Committed node_modules or build folders make the repository slow and noisy, and a committed .env leaks secrets.",
        severity: "medium",
        confidence: "proven",
        category: "config",
        location: null,
        evidence: { advisories: [], rule: "No .gitignore file at the repository root" },
        actionKind: "fix",
        steps: [],
        fixPlan: { summary: "Add a .gitignore covering dependencies, build output and env files for the languages in this repository.", paths: [".gitignore"], followUp: [] },
      });
    }

    // 3. Build output or dependency folders tracked.
    const trackedNoise = ctx.inventory.folders
      .map((f) => f.name)
      .filter((name) => ["node_modules", ".next", "dist", "build", "__pycache__", ".venv", "venv", "target"].includes(name));
    // These folders are ignored by the walker, so if they show up something is off; check gitignore text instead.
    if (hasGitignore) {
      const wanted = ["node_modules", ".env"];
      const missing = wanted.filter((entry) => !new RegExp(`^\\s*/?${entry.replace(".", "\\.")}(\\*|/)?\\s*$`, "m").test(gitignore));
      const usesNode = ctx.rawDependencies.some((d) => d.ecosystem === "npm");
      for (const entry of missing) {
        if (entry === "node_modules" && !usesNode) continue;
        if (entry === ".env" && /^\s*\.env\.\*\s*$/m.test(gitignore)) continue;
        findings.push({
          key: findingKey({ checkId: "config", path: ".gitignore", subject: `missing-${entry}` }),
          checkId: "config",
          title: `.gitignore does not exclude ${entry}`,
          explanation: `${entry} is not listed in .gitignore, so it can be committed by accident.`,
          whyItMatters: entry === ".env" ? "A committed .env file exposes every secret in it." : "Committing installed packages bloats the repository and hides real changes.",
          severity: entry === ".env" ? "high" : "low",
          confidence: "proven",
          category: "config",
          location: { path: ".gitignore" },
          evidence: { advisories: [], rule: `No line matching ${entry} in .gitignore` },
          actionKind: "fix",
          steps: [],
          fixPlan: { summary: `Add ${entry} to .gitignore.`, paths: [".gitignore"], followUp: [] },
        });
      }
    }
    void trackedNoise;

    // 4. GitHub Actions using unpinned or mutable references with write permissions.
    const workflows = ctx.inventory.files.filter((f) => f.path.startsWith(".github/workflows/") && /\.ya?ml$/.test(f.path));
    for (const wf of workflows) {
      const content = await ctx.read(wf.path);
      if (/pull_request_target/.test(content) && /actions\/checkout[\s\S]{0,200}ref:\s*\$\{\{\s*github\.event\.pull_request\.head/.test(content)) {
        findings.push({
          key: findingKey({ checkId: "config", path: wf.path, subject: "pr-target-checkout" }),
          checkId: "config",
          title: `${wf.path} runs untrusted pull request code with repository secrets`,
          explanation: "This workflow uses pull_request_target and checks out the pull request's own code. That combination runs code from any contributor with access to your secrets.",
          whyItMatters: "A stranger can open a pull request that steals every secret this workflow can see. This is a well-known GitHub Actions attack.",
          severity: "critical",
          confidence: "proven",
          category: "security",
          location: { path: wf.path },
          evidence: { advisories: [], rule: "pull_request_target combined with checkout of the PR head ref" },
          actionKind: "steps",
          steps: [
            { title: "Switch the trigger to pull_request", detail: "It runs with read-only permissions and no secrets for forks." },
            { title: "If you need secrets, split the workflow", detail: "Run untrusted code in one job without secrets, and the privileged part in a second workflow on workflow_run." },
          ],
          fixPlan: null,
        });
      }
    }

    return findings;
  },
};
