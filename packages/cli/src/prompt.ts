import { createInterface } from "node:readline";

/** The answer "y" or "yes" means yes. Enter alone, or anything else, means no. */
export function isYes(answer: string): boolean {
  return /^\s*(y|yes)\s*$/i.test(answer);
}

/**
 * Asks a [y/N] question on the terminal. Resolves null when the user
 * presses Ctrl+C or input closes, so callers can stop asking.
 */
export function askYesNo(question: string): Promise<boolean | null> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let settled = false;
    const finish = (value: boolean | null): void => {
      if (settled) return;
      settled = true;
      rl.close();
      resolve(value);
    };
    rl.on("SIGINT", () => {
      process.stdout.write("\n");
      finish(null);
    });
    rl.on("close", () => finish(null));
    rl.question(`${question} `, (answer) => finish(isYes(answer)));
  });
}
