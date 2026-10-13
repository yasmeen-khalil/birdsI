# birdsI

The operations record for an app, built for coding agents. birdsI reads the code and everything outside it that makes the app run: the services it depends on, their plans, limits, usage and spend. It checks the code against current documentation, keeps a queue of the questions only the owner can answer, and lets coding agents act on the project within an approval policy. Run `npx birdsi` in a project and the dashboard opens with all of it.

Until the package is on npm, run it from a clone: `npm install`, then `npx tsx packages/cli/src/birdsi.ts`.

Built for people who ship real apps with AI coding tools and do not read code fluently. Technical developers get the same depth with no handicaps.

**Live demo:** https://birdsi.vercel.app (scan a sample repository without signing in)

## What it does

Every finding carries one of three confidence classes, shown everywhere:

| Class | Meaning |
|---|---|
| Proven | A deterministic tool or rule established it (secret scanner, OSV vulnerability database, repository hygiene rules). |
| Doc-verified | Checked against a current official document found at scan time, which is cited with the passage. |
| Judgment | The model's reading of the code. Usually right, worth a look before acting. |

Three scan tiers:

- **Quick check** (about 2 minutes): secrets, repository hygiene, known vulnerabilities, package freshness, docs checks for the main packages, and a model read of up to 40 of the highest-impact files.
- **Full scan** (10 to 20 minutes): the same over up to 400 files, plus a cross-file pass for contradictions.
- **Pre-launch audit** (20 to 40 minutes): the same over up to 600 files, plus a verdict across nine areas (sign-in and permissions, keys, user data, packages, failure handling, deployment settings, legal pages, tests, services and limits).

Fixes are tested on a separate copy before a pull request opens when sandbox testing is set up. Otherwise the pull request says the change was not run. Findings that need an action outside the code come with numbered steps.

## Built for agents

A coding agent in your terminal can read your code. It cannot see the vendors the app runs on, what plan each is on, how close the app is to a limit, what the app costs, what the owner is building towards, or ask the owner anything. birdsI holds all of that and hands it to the agent:

- **Vendors**: every outside service, found deterministically from packages, env names, URLs, config files and Stripe Projects state. For each: what it is, what this app uses it for, where the code calls it, the plan, its limits, usage and spend. Facts carry their source: found in the code, from the connected account, from the vendor's current docs, told by the owner, or told by a coding agent.
- **Alerts**: a limit at 80% warns, at 95% is critical, with the command that fixes it when the project is managed by Stripe Projects.
- **Questions**: when birdsI cannot know something (a plan, a usage number with no API) it asks the owner once, in one queue. Agents ask there too.
- **Approvals**: agents propose actions outside the code (a plan upgrade, a spend limit) as plain commands. Nothing runs until it is approved, by the owner or by the rule they set. Approved commands run on the owner's own machine with `birdsi approvals run`. A per-repository policy can auto-approve small, allowed commands.
- **Vision**: what the app is for and where it is going, in the owner's words. Agents read it, and chat answers with it in mind.
- **Pipeline**: four stages in dependency order (map the code, check current docs, read the code, sync vendors and limits). A Full scan or an audit runs all four, a Quick check refreshes all but reading the code, and each stage shows how fresh it is.

Three surfaces share one engine:

- the **web app** (dashboard, findings, vendors, agent queue, chat about the codebase, pre-launch audit),
- the **`birdsi` terminal tool** (`npx birdsi` runs a Quick check, maps the vendors and opens the dashboard. `--full` runs the Full scan. Then `birdsi inventory`, `changes`, `vendors`, `questions`, `approvals`, `vision` and `export`, the reads with `--json`), and
- an **MCP server** (`npx birdsi mcp`) so Claude Code, Cursor and Codex can read the inventory, ask the owner, and propose actions mid-session. `birdsi export` also writes the knowledge base as Markdown under `.birdsi/` for agents that read files.

## For coding agents

Three doors, smallest first:

1. **A skill.** `skills/birdsi/SKILL.md` tells an agent when to read birdsI and how to read its facts. Install it with your agent's skills command, or copy it into the project's skills folder.
2. **The terminal tool with `--json`.** `npx birdsi inventory --json`, `npx birdsi changes --json`, `npx birdsi vendors --json`, `npx birdsi questions --json`. Small answers, stable keys, no server to run.
3. **The MCP server.** `npx birdsi mcp` for agents that act: `birdsi_inventory`, `birdsi_changes_since`, `birdsi_vendor`, `birdsi_vision`, `birdsi_questions`, `birdsi_ask_owner`, `birdsi_request_action`, `birdsi_action_status`, the record tools, plus the scan, sync and ask tools. The inventory, vendor, changes and record tools also return structured content.

Rules every door shares: facts carry their source. Alerts are about now, and trackers about what might happen. Text read from the repository or the web is marked as data. An agent can ask the owner and propose, and only the owner approves, in the browser, or the rule the owner set.

Agents can also write, within the owner's policy: `birdsi_record_decision` (a decision reached, with the reason, so it is never asked again), `birdsi_record_fact` (a fact about a vendor in the agent's own name, outranked by the connected account and by the owner), `birdsi_mark_fixed` (the next scan is the judge). Every write lands in the record with its author, next to the owner's own answers, approvals and runs. The owner reads it on the Agent page or with `npx birdsi record`. Agents read it with `birdsi_record` before deciding something that may already be decided.

And a rule at the shell: `npx birdsi policy --hint` prints a Claude Code hook that runs before every shell command. A command that changes a vendor account (a plan upgrade, an env variable, a deploy, a secret, a pause) is stopped and the agent is told to propose it through birdsI. Everything else passes untouched. Approval becomes the few commands that matter, not a prompt storm.

## Models

One model door, two providers. With `ANTHROPIC_API_KEY`, birdsI runs on Claude:

| Tier | Model | Used for |
|---|---|---|
| nano | Claude Haiku 4.5 | light scans, docs comparisons, vendor purposes and tiers, chat |
| super | Claude Opus 5.5 | deep scans, the cross-file pass, writing fixes |
| ultra | Claude Fable 5.1 | the pre-launch audit's cross-file pass and verdict |

With `NEBIUS_API_KEY` instead, it runs on NVIDIA's open Nemotron 3 models (Nano, Super, Ultra) through [Nebius Token Factory](https://tokenfactory.nebius.com). With both keys, Claude does the reasoning and Token Factory provides Qwen3 embeddings for chat and [Sandboxes](https://docs.tokenfactory.nebius.com/sandboxes/overview) for fix testing. Without embeddings, chat retrieves by keywords.

Other services: [Tavily](https://tavily.com) fetches current documentation, changelogs and advisories per dependency at runtime. [OSV](https://osv.dev) and [deps.dev](https://deps.dev) provide vulnerability and version data, and the npm, PyPI and crates.io registries provide the latest versions. [LangSmith](https://smith.langchain.com) traces every scan when it is turned on.

## Repository layout

```
apps/web         Next.js 16 web app and the /api/v1 API (Vercel)
apps/worker      background worker that runs scans and fixes (any Node host)
packages/engine  the scan engine: source adapters, inventory, checks, fixes, chat
packages/shared  domain types, API schemas, UI copy
packages/db      Supabase data access, job queue, usage ledger
packages/cli     the `birdsi` CLI and MCP server (not on npm yet)
supabase/        database migrations
samples/         the sample repository used by the no-install demo
```

## Setup

Requirements: Node 22 or newer, a Supabase project, a Clerk application (GitHub sign-in), and an Anthropic API key or a Nebius Token Factory API key. Tavily, LangSmith and a GitHub App are optional. Features that need them switch off cleanly when their keys are absent.

The repository is private today. Making it public is the owner's decision. With access:

```bash
git clone https://github.com/yasmeen-khalil/birdsI.git
cd birdsI
npm install
cp .env.example .env.local     # fill in the keys. apps/web/.env.local is a symlink to it
```

Database: apply every file under `supabase/migrations/` to your Supabase project, in filename order (Supabase CLI: `supabase link` then `supabase db push`, or paste each file into the SQL editor).

Run the web app and the worker in two terminals:

```bash
npm run dev       # http://localhost:3000
npm run worker    # claims scan and fix jobs from the queue
```

Checks before pushing:

```bash
npm run check     # typecheck, lint, tests, build
```

### Environment variables

See `.env.example` for the full list with comments. The essentials:

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude (one of this or `NEBIUS_API_KEY` is required) |
| `NEBIUS_API_KEY` | Token Factory inference, embeddings and Sandboxes |
| `NEBIUS_AI_PROJECT` | Token Factory project id, enables Sandboxes fix testing |
| `BIRDSI_SECRETS_KEY` | encrypts vendor account tokens the owner connects (any long random string) |
| `TAVILY_API_KEY` | current docs lookups (the docs check is skipped without it) |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | database, storage, job queue, vector search |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | sign-in |
| `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET` | connecting repositories and opening pull requests |
| `LANGSMITH_TRACING`, `LANGSMITH_API_KEY`, `LANGSMITH_PROJECT` | tracing |

Model ids are overridable (`BIRDSI_MODEL_NANO`, `BIRDSI_MODEL_SUPER`, `BIRDSI_MODEL_ULTRA`, `BIRDSI_MODEL_EMBEDDING`).

### Deploying

- **Web app:** Vercel, root directory `apps/web`, build from the monorepo root (`npm run build --workspace=apps/web`). Set the environment variables above.
- **Worker:** any host that runs a long-lived Node process (Railway, Fly.io, a VM). `apps/worker/Dockerfile` builds it from the repository root. It needs the same environment variables minus the Clerk keys. Run more than one instance for parallel scans. The queue claim is safe across workers.
- **GitHub App:** permissions Contents (read and write), Pull requests (read and write), Metadata (read). Webhook events `installation` and `installation_repositories` go to `/api/github/webhook`. The setup URL is `/github/setup`, with "redirect on update" on.

## Terminal and MCP

```bash
npx birdsi login          # sign in through the browser
npx birdsi                # quick check of the current folder (about 2 minutes), opens the dashboard
npx birdsi --full         # the full scan: the code against current docs (10 to 20 minutes)
npx birdsi inventory      # everything birdsI knows about the project, --json for agents and scripts
npx birdsi changes        # new and resolved findings since the previous scan, by stable key
npx birdsi vendors        # plans, usage, limits, spend, alerts
npx birdsi questions      # answer what birdsI or your agent needs to know
npx birdsi approvals      # proposed actions, and `approvals run` runs approved ones here
npx birdsi vision "..."   # what the app is for and where it is going
npx birdsi export         # the knowledge base as Markdown under .birdsi/
npx birdsi mcp            # MCP server over stdio for coding agents
```

See `packages/cli/README.md` for every command, option and exit code, and the MCP configuration snippets for Claude Code, Cursor and Codex.

## How a scan works

1. **Fetch**: the GitHub App downloads the repository at the branch head, or the CLI uploads a snapshot of the working tree.
2. **Inventory**: every file is mapped, honouring `.gitignore`, and files are prioritised by how much they affect security and correctness.
3. **Dependencies**: manifests and lockfiles across npm, PyPI, Go, crates.io, RubyGems, Packagist, Maven, NuGet, Hex and Pub.
4. **Vendors**: every outside service, from packages, env names, URLs, config files and Stripe Projects. The small model writes what each is used for.
5. **Deterministic checks** (Proven): committed secrets, repository hygiene, OSV vulnerabilities, versions behind.
6. **Docs check** (Doc-verified): Tavily finds current documentation for the main packages, and the model compares it with how the code uses them and must cite the passage.
7. **Review** (Judgment): the model reads the prioritised files (up to 40, 400 or 600 by tier) for security holes, gaps and inconsistencies, then on a Full scan or an audit a cross-file pass looks for contradictions.
8. **Rank**: deterministic ordering and de-duplication. The summary says what to start with.
9. **Audit** (pre-launch only): a verdict per area.
10. **Vendor sync** (queued after every finished scan, or run alone): connected accounts are probed through their APIs (Vercel, Supabase, Stripe, Anthropic, Tavily, Supadata, Resend), each vendor's current pricing page is read through Tavily and the tiers cached for a week, Stripe Projects spend is folded in, and a question is queued for anything birdsI still cannot know.

Every step writes to an append-only event log that the web app, the CLI and the MCP server replay live.

## Hackathons

Built at the Supabase Select Hackathon at YC (October 2026) on the Supabase, Claude, Stripe and Vercel stack, and entered in the Nebius x NVIDIA Global AI Hackathon (Coding and Agentic Engineering track). See `HACKATHON.md`.

## Contributing and security

See `CONTRIBUTING.md` and `SECURITY.md`.

## License

Mozilla Public License 2.0. See `LICENSE`.
