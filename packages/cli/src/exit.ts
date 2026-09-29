import type { Finding, ScanStatus } from "@birdsi/shared";

/**
 * Process exit codes, stable for CI scripts.
 * 0 and 1 follow the scan result; the rest describe why a run ended early.
 */
export const EXIT = {
  ok: 0,
  /** The scan finished with open findings at or above High. */
  findings: 1,
  /** The scan, or the request, could not finish. */
  failed: 2,
  /** Stopped with Ctrl+C. */
  stopped: 3,
  /** No token, or the token was refused. */
  notSignedIn: 4,
  /** Unknown command, missing argument, bad option. */
  usage: 5,
} as const;
export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/** An error that already carries the plain-language message and exit code to end with. */
export class CliError extends Error {
  readonly exitCode: ExitCode;
  /** Optional second line, printed dim: what to do next. */
  readonly hint: string | undefined;
  constructor(message: string, exitCode: ExitCode, hint?: string) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
    this.hint = hint;
  }
}

/** Findings that still count against the exit code: not dismissed, not fixed. */
export function isUnresolved(finding: Pick<Finding, "status">): boolean {
  return finding.status === "open" || finding.status === "pr_open";
}

/** Exit code for a finished (or ended) scan. */
export function exitCodeForScan(
  status: ScanStatus,
  findings: ReadonlyArray<Pick<Finding, "severity" | "status">>,
): ExitCode {
  switch (status) {
    case "done":
      return findings.some((f) => isUnresolved(f) && (f.severity === "critical" || f.severity === "high"))
        ? EXIT.findings
        : EXIT.ok;
    case "stopped":
      return EXIT.stopped;
    case "failed":
    case "queued":
    case "running":
      return EXIT.failed;
  }
}
