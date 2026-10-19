import { Command, CommanderError, Option } from "commander";
import { toCliError } from "./api";
import { dismissCommand, explainCommand, findingsCommand, fixedCommand, reposCommand } from "./commands/findings";
import { loginCommand, logoutCommand, whoamiCommand } from "./commands/auth";
import { approvalsCommand, changesCommand, decideCommand, exportCommand, inventoryCommand, questionsCommand, recordCommand, vendorsCommand, visionCommand } from "./commands/ops";
import { scanCommand } from "./commands/scan";
import { CliError, EXIT } from "./exit";
import { installInterruptHandler } from "./interrupt";
import { installHint } from "./mcp/install-hint";
import { printError } from "./output";
import { VERSION } from "./version";
import { policyCheckCommand, policyCommand } from "./commands/policy";

const asciiOption = (): Option => new Option("--ascii", "use [P] [D] [J] and plain glyphs instead of Unicode");
const jsonOption = (): Option => new Option("--json", "print the API response as JSON, for scripts");
const repoOption = (): Option => new Option("--repo <ref>", "repository id or owner/name (default: the one you scanned last)");

/** Runs a command action and turns its result or error into the process exit code. */
function run<A extends unknown[]>(action: (...args: A) => Promise<number | void>): (...args: A) => Promise<void> {
  return async (...args: A) => {
    try {
      const code = await action(...args);
      process.exitCode = code ?? EXIT.ok;
    } catch (error) {
      const cli = error instanceof CliError ? error : toCliError(error);
      printError(cli);
      process.exitCode = cli.exitCode;
    }
  };
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("birdsi")
    .description("birdsI, the cockpit for your apps. Run it in an app's folder to map the code: the services it runs on, its deployments, crons, webhooks, store apps and migrations, and what needs you.")
    .version(VERSION, "-v, --version", "print the version")
    .helpOption("-h, --help", "show help")
    .showHelpAfterError("(run birdsi --help for the full list)")
    .exitOverride()
    .argument("[path]", "the app's folder (default: the current one)")
    .option("--no-open", "do not open the app's page in the browser")
    .addOption(jsonOption())
    .addOption(asciiOption())
    .action(run((path: string | undefined, options: { open: boolean; json?: boolean; ascii?: boolean }) => scanCommand(path, { open: options.open, json: options.json, ascii: options.ascii })));

  program
    .command("login")
    .description("sign in through your browser")
    .option("--no-browser", "print the link without opening a browser")
    .action(run((options: { browser: boolean }) => loginCommand(options)));

  program
    .command("logout")
    .description("remove the saved sign-in from this computer")
    .action(run(() => logoutCommand()));

  program
    .command("whoami")
    .description("show who you are signed in as")
    .addOption(jsonOption())
    .action(run((options: { json?: boolean }) => whoamiCommand(options)));

  program
    .command("map")
    .alias("scan")
    .description("map an app's code: services, deployments, crons, webhooks, store apps, migrations (default folder: the current one)")
    .argument("[path]", "the app's folder")
    .option("--open", "open the app's page in the browser")
    .option("--branch <name>", "branch name to record, if not the current one")
    .addOption(jsonOption())
    .addOption(asciiOption())
    .addHelpText(
      "after",
      "\nExit codes: 0 nothing open at or above High, 1 open Critical or High, 2 the map could not finish,\n3 stopped with Ctrl+C, 4 not signed in, 5 usage error.",
    )
    .action(run((path: string | undefined, options: Parameters<typeof scanCommand>[1]) => scanCommand(path, options)));

  program
    .command("findings")
    .alias("list")
    .description("list the findings of a map (default: your newest map)")
    .argument("[scanId]", "the map's id")
    .addOption(jsonOption())
    .addOption(asciiOption())
    .action(run((scanId: string | undefined, options: { json?: boolean; ascii?: boolean }) => findingsCommand(scanId, options)));

  program
    .command("explain")
    .description("everything about one finding: what, why, evidence, steps")
    .argument("<finding>", "finding id, or its number in your newest map")
    .addOption(jsonOption())
    .addOption(asciiOption())
    .action(run((ref: string, options: { json?: boolean; ascii?: boolean }) => explainCommand(ref, options)));

  program
    .command("dismiss")
    .description("dismiss a finding so it stops counting")
    .argument("<finding>", "finding id, or its number in your newest map")
    .option("-y, --yes", "dismiss without asking")
    .addOption(jsonOption())
    .action(run((ref: string, options: { yes?: boolean; json?: boolean }) => dismissCommand(ref, options)));

  program
    .command("fixed")
    .description("say a finding is fixed in the code. The next map confirms it or reopens it.")
    .argument("<finding>", "finding id, or its number in your newest map")
    .option("--note <text>", "what was done")
    .addOption(jsonOption())
    .action(run((ref: string, options: { note?: string; json?: boolean }) => fixedCommand(ref, options)));

  program
    .command("record")
    .description("the record: decisions, facts, fixed marks, answers, approvals and runs, newest first")
    .option("--kind <kind>", "one kind only: decision, fact, finding_fixed, action_decided, ...")
    .option("--limit <n>", "how many entries (default 50, up to 200)")
    .addOption(repoOption())
    .addOption(jsonOption())
    .addOption(asciiOption())
    .action(run((options: { kind?: string; limit?: string; repo?: string; json?: boolean; ascii?: boolean }) => recordCommand(options)));

  program
    .command("decide")
    .description("write a decision to the record, so no agent asks about it again")
    .argument("<text...>", "the decision, in your words")
    .option("--why <text>", "the reason")
    .addOption(repoOption())
    .addOption(jsonOption())
    .action(run((text: string[], options: { why?: string; repo?: string; json?: boolean }) => decideCommand(text, options)));

  const policy = program
    .command("policy")
    .description("show the repository's agent policy. With --hint, print the Claude Code hook that enforces it.")
    .option("--hint", "print the Claude Code settings snippet for the policy hook")
    .addOption(repoOption())
    .addOption(jsonOption())
    .addOption(asciiOption())
    .action(run((options: { hint?: boolean; repo?: string; json?: boolean; ascii?: boolean }) => policyCommand(options)));
  policy
    .command("check")
    .description("exit 2 when a command changes a vendor account and must go through birdsI. The hook calls this, and it reads the hook payload from stdin.")
    .argument("[command...]", "the command, or nothing to read the hook payload from stdin")
    .addOption(repoOption())
    .addOption(jsonOption())
    .action(run((parts: string[], options: { repo?: string; json?: boolean }) => policyCheckCommand(parts, options)));

  program
    .command("repos")
    .description("list your repositories, from GitHub and from terminal uploads, with their ids")
    .addOption(jsonOption())
    .action(run((options: { json?: boolean }) => reposCommand(options)));

  program
    .command("inventory")
    .description("everything birdsI knows about the project in one read: vision, vendors, alerts, stages, what needs you")
    .addOption(repoOption())
    .addOption(jsonOption())
    .addOption(asciiOption())
    .action(run((options: { repo?: string; json?: boolean; ascii?: boolean }) => inventoryCommand(options)));

  program
    .command("changes")
    .description("new and resolved findings since the previous map, by stable key")
    .argument("[scanId]", "compare from this map instead of the previous one")
    .addOption(repoOption())
    .addOption(jsonOption())
    .addOption(asciiOption())
    .action(run((since: string | undefined, options: { repo?: string; json?: boolean; ascii?: boolean }) => changesCommand(since, options)));

  program
    .command("vendors")
    .description("the services the app runs on: what each account says, the plan's limits, alerts")
    .option("--sync", "read the connected accounts first")
    .addOption(repoOption())
    .addOption(jsonOption())
    .addOption(asciiOption())
    .action(run((options: { sync?: boolean; repo?: string; json?: boolean; ascii?: boolean }) => vendorsCommand(options)));

  program
    .command("questions")
    .description("what birdsI or your agent needs you to answer")
    .option("--answer", "answer them one by one (the default on a terminal)")
    .option("--no-answer", "only list them")
    .addOption(repoOption())
    .addOption(jsonOption())
    .addOption(asciiOption())
    .action(run((options: { answer?: boolean; repo?: string; json?: boolean; ascii?: boolean }) => questionsCommand(options)));

  program
    .command("approvals")
    .description("commands your agent proposed: list, approve, deny, or run approved ones here")
    .argument("[action]", "approve | deny | run")
    .argument("[id]", "request id")
    .option("-y, --yes", "run approved commands without asking")
    .option("--path <dir>", "folder to run commands in (default: the current one)")
    .addOption(repoOption())
    .addOption(jsonOption())
    .addOption(asciiOption())
    .action(run((action: string | undefined, id: string | undefined, options: { yes?: boolean; path?: string; repo?: string; json?: boolean; ascii?: boolean }) => approvalsCommand(action, id, options)));

  program
    .command("vision")
    .description("show or set what the app is for and where it is going")
    .argument("[text...]", "the vision, in your words")
    .option("--file <path>", "read the vision from a file")
    .addOption(repoOption())
    .addOption(jsonOption())
    .action(run((text: string[] | undefined, options: { file?: string; repo?: string; json?: boolean }) => visionCommand(text, options)));

  program
    .command("export")
    .description("write what birdsI knows about the app as Markdown under .birdsi/ for agents that read files")
    .option("--path <dir>", "project folder (default: the current one)")
    .addOption(repoOption())
    .addOption(jsonOption())
    .action(run((options: { path?: string; repo?: string; json?: boolean }) => exportCommand(options)));

  program
    .command("mcp")
    .description("run the birdsI MCP server over stdio, for coding agents")
    .option("--install-hint", "print the config snippets for Claude Code, Cursor and Codex")
    .action(
      run(async (options: { installHint?: boolean }) => {
        if (options.installHint) {
          process.stdout.write(installHint());
          return EXIT.ok;
        }
        const { runMcpServer } = await import("./mcp/server");
        // The open stdin keeps the process alive until the client disconnects.
        await runMcpServer();
        return EXIT.ok;
      }),
    );

  return program;
}

async function main(): Promise<void> {
  installInterruptHandler(() => {
    process.stderr.write("\nStopped.\n");
    process.exit(EXIT.stopped);
  });
  const program = buildProgram();
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    if (error instanceof CommanderError) {
      process.exitCode = error.exitCode === 0 ? EXIT.ok : EXIT.usage;
      return;
    }
    const cli = toCliError(error);
    printError(cli);
    process.exitCode = cli.exitCode;
  }
}

void main();
