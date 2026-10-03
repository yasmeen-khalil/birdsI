/** Config snippets for adding the birdsI MCP server to coding assistants. */
export function installHint(): string {
  const claude = {
    mcpServers: {
      birdsi: { type: "stdio", command: "npx", args: ["-y", "birdsi", "mcp"], env: { BIRDSI_TOKEN: "bsi_..." } },
    },
  };
  const cursor = {
    mcpServers: {
      birdsi: { command: "npx", args: ["-y", "birdsi", "mcp"], env: { BIRDSI_TOKEN: "bsi_..." } },
    },
  };
  return [
    "Add birdsI to your coding agent. MCP is how agents connect to tools.",
    "Replace bsi_... with your token, or leave the env block out if you",
    "ran birdsi login on this computer.",
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
    'args = ["-y", "birdsi", "mcp"]',
    'env = { BIRDSI_TOKEN = "bsi_..." }',
    "",
    "Keep the token out of files you commit. .mcp.json is often committed,",
    "so set BIRDSI_TOKEN in your shell instead and drop the env block.",
    "",
  ].join("\n");
}
