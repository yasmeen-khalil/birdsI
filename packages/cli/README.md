# birdsi

birdsI is the operations layer for coding agents: it maps a codebase, finds every outside service it runs on with plans, limits, usage and spend, audits the code against current docs, asks you what only you can answer, and lets your coding agent propose actions you approve. It reads a whole codebase and all of its dependencies, finds security holes, vulnerable packages, contradictions, inconsistencies and gaps, and checks them against current documentation. Every finding is written in plain words and carries a confidence class: Proven (a tool or rule established it), Doc-verified (checked against a cited, current official document) or Judgment (the model's reading of the code, worth checking). Each finding is either something birdsI can fix itself, tested in a sandbox first, or something you need to do, explained as steps. This package is the `birdsi` command-line tool and the birdsI MCP server for coding assistants.

## Install

Run it without installing, in your project folder:

```sh
npx birdsi
```

That runs the full pipeline (map the code, check current docs, audit, sync vendors and limits), opens the dashboard in your browser, streams progress, and ends with what needs you: limit alerts, questions, approvals. `npx birdsi --quick` does a quick check instead.

Or install it globally:

```sh
npm i -g birdsi
```

Requires Node.js 20.9 or later.

## Sign in

```sh
birdsi login
```

Opens your browser and shows a short code to approve. The token is saved in `~/.config/birdsi/config.json` (or `$XDG_CONFIG_HOME/birdsi/config.json`), readable only by you. In CI, set `BIRDSI_TOKEN` instead; it takes priority over the saved file.

```sh
birdsi whoami            # who you are signed in as
birdsi logout            # remove the saved token from this computer
```

## Commands

Every read command takes `--json` for agents and scripts, and `--repo owner/name` to pick a repository other than the one you scanned last.

### `birdsi inventory`

Everything birdsI knows about the project in one read: the vision, every vendor with plan, limits, usage and spend, the alerts, the trackers, the pipeline stages and their freshness, what needs you, the latest scan. Agents start here.

### `birdsi changes [scanId]`

New and resolved findings since the previous finished scan, by stable key (an id changes per scan; a key does not). Pass a scan id to compare from an earlier scan. Findings in files unchanged since the last scan are carried into every scan, so a quick check after a full scan does not make the full scan's findings disappear.

### `birdsi vendors`

The services the app runs on: what each is, what the app uses it for, the plan, usage against limits, spend, and alerts. `--sync` refreshes from connected accounts and current pricing pages first. `--repo owner/name` picks a repository other than the one you scanned last.

### `birdsi questions`

What birdsI or your agent needs you to answer. On a terminal it asks them one by one (type a number to pick an option, or an answer, or Enter to skip). `--no-answer` only lists them.

### `birdsi approvals [approve|deny|run] [id]`

Actions your agent proposed, with the command, the reason and the cost. Deciding happens in the browser only (`approve` and `deny` open the Agent page), so an agent can never approve its own request. `run` runs every approved command on this computer, one at a time, each after a yes (`--yes` skips the question), with a minimal environment, and reports the output back so the agent can read it. Only these programs may be run: stripe, npm, npx, pnpm, yarn, bun, vercel, supabase, railway, fly, flyctl, gh, git, node. Nothing ever runs on birdsI's servers.

### `birdsi vision [text...]`

Shows, or sets, what the app is for and where it is going. `--file VISION.md` reads it from a file. Agents and every audit read it.

### `birdsi export`

Writes the knowledge base as Markdown under `.birdsi/` (vision, vendors, alerts, questions) so agents that read files instead of MCP get the same picture.

### `birdsi scan [path]`

Scans a folder (default: the current one). birdsI packs the folder, leaving out everything your `.gitignore` files exclude (at every level) plus build output, dependencies, binary files, and always your `.env` files and private keys, whatever `.gitignore` says; uploads it; and streams progress as the scan runs. Uploaded code is kept for up to seven days so fixes can be applied, then deleted.

```sh
birdsi scan                                  # light scan of the current folder
birdsi scan ./my-app --deep                  # deep scan: reads all the code
birdsi scan --audit --describe "Bookings for a yoga studio, paid with Stripe"
birdsi scan --json > result.json             # the final result as JSON, nothing else
```

| Option | What it does |
| --- | --- |
| `--full` | The whole pipeline in order, then the vendor sync (what `birdsi` with no command runs). |
| `--open` | Open the dashboard in the browser once the scan starts. |
| `--deep` | Deep scan: reads all the code. |
| `--audit` | Pre-launch audit: the deepest scan, with a ready or not-ready verdict per area. |
| `--describe <text>` | What the app does, in a sentence or two. Sharpens the scan. |
| `--branch <name>` | Branch name to record, when it is not the current one. |
| `--json` | Print the final scan response as JSON only. |
| `--no-fix-prompt` | Do not offer fixes after the scan. |
| `--ascii` | Use `[P] [D] [J]` and plain glyphs instead of Unicode. |

When the scan finishes, birdsI prints a summary and every finding, grouped by severity (critical, high, medium, low). Then, on a terminal, it walks through each finding it can fix, one question at a time, in severity order. Every fix needs an explicit `y`; Enter alone means no. For repositories connected through the birdsI GitHub App, a yes opens a pull request. For local folders, a yes applies the tested change to your files with `git apply --3way`; if that is not possible, the change is saved as `birdsi-fix-<id>.patch` with the command to apply it.

Press Ctrl+C once to stop the scan on the server. Snapshots are limited to 40,000 files and 200 MB; single files over 2 MB are left out.

Confidence glyphs: `●` Proven, `◉` Doc-verified, `◌` Judgment. Without Unicode, or with `--ascii`: `[P]`, `[D]`, `[J]`. Colour is used only on a terminal and never when `NO_COLOR` is set; it never carries meaning on its own.

### `birdsi findings [scanId]`

Lists the findings of a scan, numbered. Without an id, uses your newest scan from this computer. Also available as `birdsi list`.

```sh
birdsi findings
birdsi findings scan_8f2c --json
```

### `birdsi explain <finding>`

Everything about one finding: what is wrong, why it matters, the evidence, the steps or fix plan, and what its confidence class means. Takes a finding id, or the number shown next to it in your newest scan.

```sh
birdsi explain 4
```

### `birdsi fix <finding>`

Has birdsI write and sandbox-test a fix, then prints the pull request link. When there is no pull request (a local folder scan), prints the change as a patch, or applies it with `--apply`.

```sh
birdsi fix 1                       # print the pull request link or the patch
birdsi fix 1 --apply               # apply the change to the current folder
birdsi fix f_91ab --apply --path ./my-app
birdsi fix 1 --json
```

### `birdsi dismiss <finding>`

Dismisses a finding so it stops counting in later scans. Asks first; `--yes` skips the question.

### `birdsi repos`

Lists repositories connected through the GitHub App, with their ids.

### `birdsi ask <repo> <question>`

Asks a question about a connected repository. The answer cites files and findings.

```sh
birdsi ask acme/studio-bookings "Where do we check that a user owns a booking?"
```

Every command that prints data accepts `--json`, which prints the API response exactly as received.

## MCP server

`birdsi mcp` runs the birdsI MCP server over stdio, so coding assistants can read the project's operational record, ask the owner, propose actions, scan and apply fixes mid-session. It uses the token from `birdsi login`, or `BIRDSI_TOKEN` in the environment.

Tools: `birdsi_inventory` (call this first: vision, vendors, alerts, stages, what needs the owner), `birdsi_changes_since` (new and resolved findings by stable key), `birdsi_vendor`, `birdsi_vision`, `birdsi_questions`, `birdsi_ask_owner`, `birdsi_request_action`, `birdsi_action_status`, `birdsi_sync_vendors`, `birdsi_scan` (with `full`; returns after four minutes if the scan is still running), `birdsi_scan_status`, `birdsi_findings`, `birdsi_finding`, `birdsi_fix`, `birdsi_repos`, `birdsi_ask`. The inventory, vendor and changes tools return structured content as well as text. Text read from a repository or the web is marked between `«` and `»` in every result.

`birdsi mcp --install-hint` prints these snippets with the current version pinned, so a release never changes what your agent runs until you choose it. No token goes in any file: the server reads the one `birdsi login` saved. In CI or a sandbox, set `BIRDSI_TOKEN` in the environment.

Claude Code, `.mcp.json` at the project root:

```json
{
  "mcpServers": {
    "birdsi": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "birdsi@0.2.0", "mcp"]
    }
  }
}
```

Cursor, `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "birdsi": {
      "command": "npx",
      "args": ["-y", "birdsi@0.2.0", "mcp"]
    }
  }
}
```

Codex, `~/.codex/config.toml`:

```toml
[mcp_servers.birdsi]
command = "npx"
args = ["-y", "birdsi@0.2.0", "mcp"]
```

A skill that tells an agent when to read birdsI and how to read its facts: `skills/birdsi/SKILL.md` in the repository.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Done, with no open findings at or above High. |
| 1 | Done, with open findings at or above High (critical or high). |
| 2 | The scan or request could not finish (scan failed, network error, refused request). |
| 3 | Stopped with Ctrl+C. |
| 4 | Not signed in, or the token was refused. |
| 5 | Usage error: unknown command, missing argument, or a folder birdsI cannot scan. |

Dismissed and fixed findings do not count toward exit code 1.

## Environment

| Variable | Purpose |
| --- | --- |
| `BIRDSI_TOKEN` | Token to use instead of the saved sign-in. Starts with `bsi_`. |
| `BIRDSI_API_URL` | birdsI address. Default `https://birdsi.vercel.app`. Must be https, except for localhost. |
| `XDG_CONFIG_HOME` | Where the config folder lives. Default `~/.config`. |
| `NO_COLOR` | Turns colour off. |

## License

MPL-2.0
