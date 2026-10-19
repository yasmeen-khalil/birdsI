# birdsi

birdsI is the cockpit for your apps. It maps an app from its code (the services it runs on, its deployments, crons, webhooks, store apps, migrations and env names), reads the vendor accounts you connect with keys that only read, and tells you what needs you. No model reads the code. Rule-based checks run with every map: committed keys, unsafe settings, published vulnerabilities, packages far behind. Every finding carries a confidence class: Proven (a rule or a database found it) or Doc-verified (checked against the package's own current documentation, cited). Judgment marks a model's reading from before birdsI stopped reading code with a model. birdsI writes no code: your coding agent makes the change, and the next map confirms it. This package is the `birdsi` command-line tool and the birdsI MCP server for coding assistants.

## Install

Run it without installing, in your project folder:

```sh
npx birdsi
```

That maps the app in the current folder (about a minute), opens its page, streams progress, and ends with what needs you: alerts, questions, approvals.

Until the package is on npm, run it from a clone: `npm install`, then `npx tsx packages/cli/src/birdsi.ts`.

Once it is on npm, you can also install it globally:

```sh
npm i -g birdsi
```

Requires Node.js 20.9 or later.

## Sign in

```sh
birdsi login
```

Opens your browser and shows a short code to approve. `--no-browser` prints the link instead of opening a browser. The token is saved in `~/.config/birdsi/config.json` (or `$XDG_CONFIG_HOME/birdsi/config.json`), readable only by you. In CI, set `BIRDSI_TOKEN` instead. It takes priority over the saved file.

```sh
birdsi whoami            # who you are signed in as
birdsi logout            # remove the saved token from this computer
```

## Commands

Read commands take `--json`. Commands about one repository take `--repo owner/name` to pick one other than the one you mapped last.

### `birdsi` with no command

Maps the app in the current folder, or in the folder you name, the same as `birdsi map`. `--no-open` keeps its page closed. `--json` and `--ascii` work as they do for `birdsi map`.

### `birdsi inventory`

Everything birdsI knows about the app in one read: the vision, every vendor with what its account says and its plan's limits, the alerts, the trackers, how fresh the map and the account reads are, what needs you, the latest map. Agents start here.

### `birdsi changes [scanId]`

New and resolved findings since the previous finished map, by stable key (an id changes per map, a key does not). Pass a map's id to compare from an earlier one. Findings from the model review that ran before v3 are left out of the comparison, so they never show as resolved.

### `birdsi record`

The record of the app: decisions, facts stated, findings marked fixed or dismissed, answers, approvals and runs, newest first, each with who wrote it and why. `--kind decision` (or any kind) filters, and an unknown kind is a usage error. `--limit` sets how many entries (default 50, up to 200).

### `birdsi decide <text...>`

Writes a decision to the record in your words, with `--why`, so no agent asks about it again.

### `birdsi fixed <finding>`

Says a finding is fixed in the code (`--note` what was done). The next map confirms it or reopens it.

### `birdsi policy`

The repository's agent policy in words: whether agents may ask and propose, whether they may write to the record, and what is approved without asking. `--hint` prints the Claude Code hook below.

### `birdsi policy check [command...]`

Exit 0 when a command changes nothing. Exit 2, with the reason on stderr, when it changes a vendor account (a plan, an env variable, a deploy, a secret, a pause) and must go through birdsI. With no argument it reads a Claude Code hook payload from stdin. Commands that change nothing never touch the network. When birdsI cannot be reached, account-changing commands stay blocked.

Claude Code, in `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [{ "type": "command", "command": "npx -y birdsi@0.2.0 policy check" }] }
    ]
  }
}
```

### `birdsi vendors`

The services the app runs on: what each is, what its account says, the plan's checked limits, and alerts. `--sync` reads the connected accounts first. `--repo owner/name` picks a repository other than the one you mapped last.

### `birdsi questions`

What your coding agent needs you to answer. On a terminal it asks them one by one (type a number to pick an option, or an answer, or Enter to skip). `--no-answer` only lists them.

### `birdsi approvals [approve|deny|run] [id]`

Actions your agent proposed, with the command, the reason and the cost. Deciding happens in the browser only (`approve` and `deny` open the Agent page), so an agent can never approve its own request. `run` runs every approved command (or only the one whose id you give) in the current folder, or in `--path <dir>`, one at a time, each after a yes (`--yes` skips the question), with a minimal environment, and reports the output back so the agent can read it. Only these programs may be run: stripe, npm, npx, pnpm, yarn, bun, vercel, supabase, railway, fly, flyctl, gh, git, node. Nothing ever runs on birdsI's servers.

### `birdsi vision [text...]`

Shows, or sets, what the app is for and where it is going. `--file VISION.md` reads it from a file. Agents read it.

### `birdsi export`

Writes the knowledge base as Markdown under `.birdsi/` (README, vision, vendors, alerts, questions and the record) so agents that read files instead of MCP get the same picture.

### `birdsi map [path]`

Maps a folder (default: the current one). Also available as `birdsi scan`. birdsI packs the folder, leaving out everything your `.gitignore` files exclude (at every level), plus build output, dependencies, common binary types (images, fonts, archives, media, compiled files), and always your `.env` files, private keys and certificates, whatever `.gitignore` says. Then it uploads the folder and streams progress as the map runs. The upload is deleted on birdsI as soon as the map has run.

```sh
birdsi map                                   # map the current folder
birdsi map ./my-app --open                   # and open the app's page
birdsi map --json > result.json              # the final result as JSON, nothing else
```

| Option | What it does |
| --- | --- |
| `--open` | Open the app's page in the browser once the map starts. |
| `--branch <name>` | Branch name to record, when it is not the current one. |
| `--json` | Print the final response as JSON only. |
| `--ascii` | Use `[P] [D] [J]` and plain glyphs instead of Unicode. |

When the map finishes, birdsI prints a summary and every finding, grouped by severity (critical, high, medium, low), then what needs you outside the code. Press Ctrl+C once to stop the map on the server. Snapshots are limited to 40,000 files and 200 MB. Single files over 2 MB are left out, except lockfiles up to 20 MB.

Confidence glyphs: `●` Proven, `◉` Doc-verified, `◌` Judgment. Without Unicode, or with `--ascii`: `[P]`, `[D]`, `[J]`. Colour is used only on a terminal and never when `NO_COLOR` is set. It never carries meaning on its own.

### `birdsi findings [scanId]`

Lists the findings of a map, numbered. Without an id, uses your newest map from this computer. Also available as `birdsi list`.

```sh
birdsi findings
birdsi findings scan_8f2c --json
```

### `birdsi explain <finding>`

Everything about one finding: what is wrong, why it matters, the evidence, the steps or the change that fixes it, and what its confidence class means. Takes a finding id, or the number shown next to it in your newest map.

```sh
birdsi explain 4
```

### `birdsi dismiss <finding>`

Dismisses a finding so it stops counting in later maps. Asks first, and `--yes` skips the question.

### `birdsi repos`

Lists your repositories, from GitHub and from terminal uploads, with their ids.

Every command that prints data accepts `--json`, which prints the API response exactly as received. `birdsi questions --json` lists open questions only.

## MCP server

`birdsi mcp` runs the birdsI MCP server over stdio, so coding assistants can read the app's cockpit, ask the owner, propose actions and map the code mid-session. It uses the token from `birdsi login`, or `BIRDSI_TOKEN` in the environment.

Tools: `birdsi_inventory` (call this first: vision, vendors, alerts, freshness, what needs the owner), `birdsi_changes_since` (new and resolved findings by stable key), `birdsi_vendor`, `birdsi_vision`, `birdsi_questions`, `birdsi_ask_owner`, `birdsi_request_action`, `birdsi_action_status`, `birdsi_record` (the record, newest first), `birdsi_record_decision`, `birdsi_record_fact`, `birdsi_mark_fixed` (writes, within the owner's policy, each logged with its author), `birdsi_sync_vendors` (reads the accounts now), `birdsi_scan` (maps a folder, and returns after four minutes if the map is still running), `birdsi_scan_status`, `birdsi_findings`, `birdsi_finding`, `birdsi_repos`. The inventory, vendor, changes and record tools return structured content as well as text. Text read from a repository or the web is marked between `«` and `»` in the inventory, vendor, questions, changes, record and finding results.

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
| 2 | The map or request could not finish (map failed, network error, refused request). |
| 3 | Stopped with Ctrl+C. |
| 4 | Not signed in, or the token was refused. |
| 5 | Usage error: unknown command, missing argument, or a folder birdsI cannot map. |

Dismissed and fixed findings do not count toward exit code 1. `birdsi policy check` exits 2 when a command must go through birdsI.

## Environment

| Variable | Purpose |
| --- | --- |
| `BIRDSI_TOKEN` | Token to use instead of the saved sign-in. Starts with `bsi_`. |
| `BIRDSI_API_URL` | birdsI address. Default `https://birdsi.vercel.app`. Must be https, except for localhost. |
| `XDG_CONFIG_HOME` | Where the config folder lives. Default `~/.config`. |
| `NO_COLOR` | Turns colour off. |

## License

MPL-2.0
