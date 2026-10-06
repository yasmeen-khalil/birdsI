import { VERSION } from "../version";

/** Config snippets for adding the birdsI MCP server to coding assistants. */
export function installHint(): string {
  const args = ["-y", `birdsi@${VERSION}`, "mcp"];
  const claude = { mcpServers: { birdsi: { type: "stdio", command: "npx", args } } };
  const cursor = { mcpServers: { birdsi: { command: "npx", args } } };
  return [
    "Add birdsI to your coding agent. MCP is how agents connect to tools.",
    "",
    "No token goes in any file: the server reads the one birdsi login saved",
    "on this computer. In CI or a sandbox, set BIRDSI_TOKEN in the environment.",
    `The version is pinned (${VERSION}) so a release never changes what your`,
    "agent runs until you choose it. This command prints the current pin.",
    "",
    "Claude Code, in .mcp.json at the project root:",
    "",
    JSON.stringify(claude, null, 2),
    "",
    "Cursor, in .cursor/mcp.json:",
    "",
    JSON.stringify(cursor, null, 2),
    "",
    "Codex, in ~/.codex/config.toml:",
    "",
    "[mcp_servers.birdsi]",
    'command = "npx"',
    `args = ${JSON.stringify(args)}`,
    "",
    "A skill that tells the agent when to read birdsI: skills/birdsi/SKILL.md",
    "in the birdsI repository.",
    "",
  ].join("\n");
}
