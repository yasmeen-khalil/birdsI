import { describe, expect, it } from "vitest";
import { commandProgram, isAllowedCommand } from "./ops";

describe("isAllowedCommand", () => {
  it("accepts allowlisted programs with plain arguments", () => {
    expect(isAllowedCommand("stripe projects upgrade vercel pro")).toBe(true);
    expect(isAllowedCommand("npm install next@16.3.8")).toBe(true);
    expect(commandProgram("  vercel env pull")).toBe("vercel");
  });

  it("refuses other programs, shell operators and output redirection", () => {
    expect(isAllowedCommand("curl https://x.y -o ~/.zshrc")).toBe(false);
    expect(isAllowedCommand("rm -rf /")).toBe(false);
    expect(isAllowedCommand("npm install && curl x")).toBe(false);
    expect(isAllowedCommand("git log > out.txt")).toBe(false);
    expect(isAllowedCommand("stripe projects status\nrm x")).toBe(false);
    expect(isAllowedCommand("npm run build --output=../x")).toBe(false);
  });
});
