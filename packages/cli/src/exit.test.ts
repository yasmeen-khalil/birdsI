import { describe, expect, it } from "vitest";
import { ApiRequestError, NetworkError, toCliError } from "./api";
import { EXIT, exitCodeForScan } from "./exit";

describe("exitCodeForScan", () => {
  it("is 0 when the scan is done with nothing at or above High", () => {
    expect(exitCodeForScan("done", [])).toBe(0);
    expect(exitCodeForScan("done", [{ severity: "medium", status: "open" }, { severity: "low", status: "open" }])).toBe(0);
  });

  it("is 1 when an open finding is critical or high", () => {
    expect(exitCodeForScan("done", [{ severity: "high", status: "open" }])).toBe(1);
    expect(exitCodeForScan("done", [{ severity: "low", status: "open" }, { severity: "critical", status: "open" }])).toBe(1);
  });

  it("still counts a finding whose pull request is open but not merged", () => {
    expect(exitCodeForScan("done", [{ severity: "critical", status: "pr_open" }])).toBe(1);
  });

  it("ignores dismissed and fixed findings", () => {
    expect(exitCodeForScan("done", [{ severity: "critical", status: "dismissed" }, { severity: "high", status: "fixed" }])).toBe(0);
  });

  it("is 2 when the scan failed, 3 when stopped", () => {
    expect(exitCodeForScan("failed", [{ severity: "critical", status: "open" }])).toBe(2);
    expect(exitCodeForScan("stopped", [])).toBe(3);
    expect(exitCodeForScan("running", [])).toBe(2);
  });
});

describe("toCliError", () => {
  it("maps 401 to not signed in", () => {
    const e = toCliError(new ApiRequestError(401, "unauthorized", "Bad token"));
    expect(e.exitCode).toBe(EXIT.notSignedIn);
    expect(e.hint).toContain("birdsi login");
  });

  it("maps 402, 403, 404, 429 and 5xx to plain messages with exit 2", () => {
    for (const status of [402, 403, 404, 429, 500, 503]) {
      const e = toCliError(new ApiRequestError(status, "x", "Server said so"));
      expect(e.exitCode).toBe(EXIT.failed);
      expect(e.message).not.toMatch(/\u2014/);
    }
    expect(toCliError(new ApiRequestError(402, "budget", "Monthly budget reached")).message).toContain("budget");
  });

  it("maps a network failure to exit 2 with a connection hint", () => {
    const e = toCliError(new NetworkError("birdsI could not be reached."));
    expect(e.exitCode).toBe(EXIT.failed);
    expect(e.hint).toMatch(/connection/);
  });
});
