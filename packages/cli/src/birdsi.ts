import { Command, CommanderError, Option } from "commander";
import { toCliError } from "./api";
import { askCommand, dismissCommand, explainCommand, findingsCommand, reposCommand } from "./commands/findings";
import { fixCommand } from "./commands/fix";
import { loginCommand, logoutCommand, whoamiCommand } from "./commands/auth";
import { scanCommand } from "./commands/scan";
import { CliError, EXIT } from "./exit";
import { installInterruptHandler } from "./interrupt";
import { installHint } from "./mcp/install-hint";
import { printError } from "./output";
import { VERSION } from "./version";

const asciiOption = (): Option => new Option("--ascii", "use [P] [D] [J] and plain glyphs instead of Unicode");
const jsonOption = (): Option => new Option("--json", "print the API response as JSON, for scripts");

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
    .description("birdsI: scan a codebase, read findings in plain words, approve fixes.")
    .version(VERSION, "-v, --version", "print the version")
    .helpOption("-h, --help", "show help")
    .showHelpAfterError("(run birdsi --help for the full list)")
    .exitOverride();

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
    .command("scan")
    .description("scan a folder (default: the current one)")
    .argument("[path]", "folder to scan")
    .option("--deep", "deep scan: reads all the code")
    .option("--audit", "pre-launch audit: the deepest scan")
    .option("--describe <text>", "what the app does, in a sentence or two")
    .option("--branch <name>", "branch name to record, if not the current one")
    .addOption(jsonOption())
    .option("--no-fix-prompt", "do not offer fixes after the scan")
    .addOption(asciiOption())
    .addHelpText(
      "after",
      "\nExit codes: 0 nothing at or above High, 1 findings at or above High, 2 the scan could not finish,\n3 stopped with Ctrl+C, 4 not signed in, 5 usage error.",
    )
    .action(run((path: string | undefined, options: Parameters<typeof scanCommand>[1]) => scanCommand(path, options)));

  program
    .command("findings")
    .alias("list")
    .description("list the findings of a scan (default: your newest scan)")
    .argument("[scanId]", "scan id")
    .addOption(jsonOption())
    .addOption(asciiOption())
    .action(run((scanId: string | undefined, options: { json?: boolean; ascii?: boolean }) => findingsCommand(scanId, options)));

  program
    .command("explain")
    .description("everything about one finding: what, why, evidence, steps")
    .argument("<finding>", "finding id, or its number in your newest scan")
    .addOption(jsonOption())
    .addOption(asciiOption())
    .action(run((ref: string, options: { json?: boolean; ascii?: boolean }) => explainCommand(ref, options)));

  program
    .command("fix")
    .description("have birdsI fix a finding: opens a pull request, or gives you the change")
    .argument("<finding>", "finding id, or its number in your newest scan")
    .option("--apply", "apply the change to your local folder when there is no pull request")
    .option("--path <dir>", "folder to apply the change in (default: the current one)")
    .addOption(jsonOption())
    .addOption(asciiOption())
    .action(
      run((ref: string, options: { apply?: boolean; path?: string; json?: boolean; ascii?: boolean }) => fixCommand(ref, options)),
    );

  program
    .command("dismiss")
    .description("dismiss a finding so it stops counting")
    .argument("<finding>", "finding id, or its number in your newest scan")
    .option("-y, --yes", "dismiss without asking")
    .addOption(jsonOption())
    .action(run((ref: string, options: { yes?: boolean; json?: boolean }) => dismissCommand(ref, options)));

  program
    .command("repos")
    .description("list repositories connected through the GitHub App")
    .addOption(jsonOption())
    .action(run((options: { json?: boolean }) => reposCommand(options)));

  program
    .command("ask")
    .description("ask a question about a connected repository")
    .argument("<repo>", "repository id or owner/name")
    .argument("<question...>", "your question")
    .addOption(jsonOption())
    .action(run((repo: string, question: string[], options: { json?: boolean }) => askCommand(repo, question, options)));

  program
    .command("mcp")
    .description("run the birdsI MCP server over stdio, for coding assistants")
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
