import { VERSION } from "../version";
import { accountChange, checkCommand } from "@birdsi/shared";
import { ApiClient, toCliError } from "../api";
import { EXIT } from "../exit";
import { paint, styleFor, wrap } from "../format";
import { isInteractive, printJson, println, usageError } from "../output";
import { resolveRepo } from "./ops";

/** The repository's agent policy, in words. */
export async function policyCommand(options: { repo?: string; json?: boolean; ascii?: boolean; hint?: boolean }): Promise<number> {
  if (options.hint) {
    process.stdout.write(hookHint());
    return EXIT.ok;
  }
  const style = styleFor(process.stdout, options);
  const { api } = await ApiClient.fromEnvironment();
  api.requireAuth();
  try {
    const repo = await resolveRepo(api, options.repo);
    const result = await api.policy(repo.id);
    if (options.json) {
      printJson(result.raw);
      return EXIT.ok;
    }
    const p = result.data.policy;
    println(paint.bold(style, `Agent policy for ${repo.fullName}`));
    println(`  Agents may ask questions and propose commands: ${p.allowPropose ? "yes" : "no"}`);
    println(`  Agents may write to the record: ${p.allowWrite ? "yes" : "no"}`);
    println(`  Approved without asking: ${p.autoApproveUnderUsd === null ? "nothing, the owner is always asked" : `commands at or under $${p.autoApproveUnderUsd} a month that start with ${p.autoApprovePrefixes.join(", ")}`}`);
    println();
    println(wrap("Account-changing commands from an agent's shell (plan upgrades, env changes, deploys, secrets, pauses) go through birdsI with the hook: birdsi policy --hint", style, "  "));
    return EXIT.ok;
  } catch (error) {
    throw toCliError(error, "the policy");
  }
}

/** Reads a Claude Code hook payload from stdin: the command is tool_input.command. Plain text works too. */
async function commandFromStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw) as { tool_name?: string; tool_input?: { command?: string } };
    if (parsed.tool_name && parsed.tool_name !== "Bash") return "";
    return parsed.tool_input?.command ?? "";
  } catch {
    return raw;
  }
}

/**
 * The hook. Exit 0 lets the command run. Exit 2 blocks it and the reason on
 * stderr reaches the agent. Commands that change nothing never touch the
 * network; an account-changing one is checked against the repository's
 * policy, and when birdsI cannot be reached it is blocked, not waved through.
 */
export async function policyCheckCommand(parts: string[], options: { repo?: string; json?: boolean }): Promise<number> {
  let command = parts.join(" ").trim();
  if (!command) {
    if (isInteractive()) throw usageError("Which command?", 'Example: birdsi policy check "vercel env add KEY production", or pipe a Claude Code hook payload in.');
    command = await commandFromStdin();
  }
  if (!command) return EXIT.ok;
  if (!accountChange(command)) {
    if (options.json) printJson({ verdict: "allow", vendor: null, reason: "Not an account change." });
    return EXIT.ok;
  }
  let verdict = checkCommand(command, null);
  try {
    const { api } = await ApiClient.fromEnvironment();
    api.requireAuth();
    const repo = await resolveRepo(api, options.repo);
    verdict = checkCommand(command, (await api.policy(repo.id)).data.policy);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    verdict = { ...verdict, reason: `${verdict.reason} (birdsI could not be reached to read the policy: ${message})` };
  }
  if (options.json) printJson(verdict);
  if (verdict.verdict === "allow") return EXIT.ok;
  process.stderr.write(`birdsI: ${verdict.reason}\n`);
  return 2;
}

/** The Claude Code settings snippet that runs the hook before every shell command. */
export function hookHint(): string {
  const settings = {
    hooks: {
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: `npx -y birdsi@${VERSION} policy check` }] }],
    },
  };
  return [
    "Make the owner's policy a rule at the agent's shell. Claude Code runs this",
    "before every Bash command: commands that change a vendor account (a plan,",
    "an env variable, a deploy, a secret, a pause) are stopped and the agent is",
    "told to propose them through birdsI instead. Everything else passes.",
    "",
    "Add to .claude/settings.json in the project (or ~/.claude/settings.json):",
    "",
    JSON.stringify(settings, null, 2),
    "",
    "The hook needs birdsi login on this computer, or BIRDSI_TOKEN in the",
    "environment, to read the repository's policy. When birdsI cannot be",
    "reached, account-changing commands stay blocked and the rest still pass.",
    "",
  ].join("\n");
}
