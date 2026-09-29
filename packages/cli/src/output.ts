import { CliError, EXIT } from "./exit";
import { paint, styleFor, type Style } from "./format";

export function println(line = ""): void {
  process.stdout.write(line + "\n");
}

/** Prints JSON exactly as received, for scripts. */
export function printJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

/** Errors go to stderr, one plain sentence plus an optional hint. */
export function printError(error: CliError): void {
  const style: Style = styleFor(process.stderr);
  process.stderr.write(`${paint.fail(style, "Error:")} ${error.message}\n`);
  if (error.hint) process.stderr.write(`${paint.dim(style, error.hint)}\n`);
}

/** True when the user can answer questions: both ends are a terminal. */
export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

/**
 * Rewrites one status line in place on a terminal; prints each distinct
 * line once elsewhere.
 */
export class StatusLine {
  private readonly live = Boolean(process.stdout.isTTY);
  private last: string | null = null;
  private shown = false;

  set(text: string): void {
    if (text === this.last) return;
    this.last = text;
    if (this.live) {
      process.stdout.write(`\r\x1b[K${text}`);
      this.shown = true;
    } else {
      process.stdout.write(text + "\n");
    }
  }

  /** Clears the in-place line so the next output starts clean. */
  clear(): void {
    if (this.live && this.shown) process.stdout.write("\r\x1b[K");
    this.shown = false;
    this.last = null;
  }
}

export function usageError(message: string, hint?: string): CliError {
  return new CliError(message, EXIT.usage, hint);
}
