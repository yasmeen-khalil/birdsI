# birdsI

The cockpit for your apps. birdsI maps each app from its code: the services it runs on, its deployments, crons, webhooks, store apps, migrations and the settings each deployment needs. Then it reads the vendor accounts with keys that only read, and tells you what needs you. No model reads the code.

Run `npx birdsi` in an app's folder and its page opens with all of it. Until the package is on npm, run it from a clone: `npm install`, then `npx tsx packages/cli/src/birdsi.ts`.

birdsI is its owner's cockpit for their own apps first. A product for others comes later.

## What it does

- **The map, from the code.** Every outside service the app uses, found by rules from packages, imports, env names, web addresses and config files, each with the file and line it came from. Rule-based checks run with it: committed keys, unsafe settings, published vulnerabilities (OSV), packages two or more majors behind. When its keys are set, the docs check compares a main package's own current documentation with how the code imports it, and must cite the page.
- **Apps and their projects.** Each app is a record with the vendor projects it has: one Vercel project per deployment, the Supabase project, the OneSignal app, and the rest. A key belongs to one project, only reads, is checked with the vendor before it is stored, and is never shown again.
- **What the accounts say.** With those keys, birdsI reads each project: plan, usage, status. Every reading is dated. When it cannot read a project, it says so.
- **The checked limits list.** What each vendor's plans include, what ends them and the next price, read by a person from each vendor's own pricing page, dated and quoted (`packages/shared/src/limits.ts`). A model never reads a pricing page.
- **Alerts.** Something true now: a limit at 80 or 95 percent, a paused project, an account that could not be read. A condition that might happen (a free plan that pauses) is a tracker, never an alert.
- **Approvals and the record.** Your coding agent proposes a command, you approve it in the browser, it runs on your own computer. Every decision, fact, approval and run lands in an append-only record with its author.

## Built for agents

A coding agent can read the code. It cannot see what the app runs on or what the owner decided. birdsI hands it that, through three doors:

1. **A skill.** `skills/birdsi/SKILL.md` tells an agent when to read birdsI and how to read its facts.
2. **The terminal tool with `--json`.** `npx birdsi inventory --json`, `changes --json`, `vendors --json`, `questions --json`, `record --json`.
3. **The MCP server.** `npx birdsi mcp`: `birdsi_inventory`, `birdsi_changes_since`, `birdsi_vendor`, `birdsi_vision`, `birdsi_questions`, `birdsi_ask_owner`, `birdsi_request_action`, `birdsi_action_status`, the record tools, the findings tools, and the map and read tools.

An agent can ask the owner and propose, and only the owner approves, in the browser. `npx birdsi policy --hint` prints a Claude Code hook that stops account-changing shell commands and routes them through approvals.

## Repository layout

```
apps/web         Next.js 16 web app and the /api/v1 API (Vercel)
apps/worker      background worker: maps the code and reads the accounts (any Node host)
packages/engine  the engine: source adapters, inventory, discovery, checks, connectors, alert rules
packages/shared  domain types, API schemas, the checked limits list, UI copy
packages/db      Supabase data access, job queue, usage ledger
packages/cli     the `birdsi` CLI and MCP server (not on npm yet)
supabase/        database migrations and verify.sql
```

## Setup

Requirements: Node 22 or newer, a Supabase project, a Clerk application (GitHub sign-in). Anthropic and Tavily keys are optional: they switch on the docs check. A GitHub App is optional.

The repository is private today. Making it public is the owner's decision. With access:

```bash
git clone https://github.com/yasmeen-khalil/birdsI.git
cd birdsI
npm install
cp .env.example .env.local     # fill in the keys. apps/web/.env.local is a symlink to it
```

Database: apply every file under `supabase/migrations/` to your Supabase project, in filename order (paste each into the SQL editor, or `supabase db push`). Then paste `supabase/verify.sql` and run it: every row should say OK.

Run the web app and the worker in two terminals:

```bash
npm run dev       # http://localhost:3000
npm run worker    # claims map and read jobs from the queue
```

Checks before committing:

```bash
npm run verify    # typecheck, lint, tests, build
```

### Environment variables

See `.env.example` for the full list with comments. The essentials:

| Variable | Purpose |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | database, storage, job queue |
| `BIRDSI_SECRETS_KEY` | encrypts the vendor keys you connect (any long random string) |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | sign-in |
| `ANTHROPIC_API_KEY`, `TAVILY_API_KEY` | optional: the docs check, skipped without both |
| `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET` | optional: reading repositories through the GitHub App |

### Deploying

- **Web app:** Vercel, root directory `apps/web`, build from the monorepo root (`npm run build --workspace=apps/web`).
- **Worker:** any host that runs a long-lived Node process (Railway, Fly.io, a VM). `apps/worker/Dockerfile` builds it from the repository root. It needs the same environment variables minus the Clerk keys.
- **GitHub App (optional):** permissions Contents (read) and Metadata (read), nothing that writes. Webhook events `installation` and `installation_repositories` go to `/api/github/webhook`. The setup URL is `/github/setup`, with "redirect on update" on.

## Terminal and MCP

```bash
npx birdsi login          # sign in through the browser
npx birdsi                # map the app in the current folder, then open its page
npx birdsi inventory      # everything birdsI knows about the app, --json for agents and scripts
npx birdsi changes        # new and resolved findings since the previous map, by stable key
npx birdsi vendors        # what each account says, the plans' limits, alerts
npx birdsi questions      # answer what your agent needs to know
npx birdsi approvals      # proposed commands, and `approvals run` runs approved ones here
npx birdsi vision "..."   # what the app is for and where it is going
npx birdsi export         # what birdsI knows, as Markdown under .birdsi/
npx birdsi mcp            # MCP server over stdio for coding agents
```

See `packages/cli/README.md` for every command, option and exit code, and the MCP configuration for Claude Code, Cursor and Codex.

## How a map works

1. **Fetch**: the terminal tool uploads a snapshot of the working tree (env files, keys and what `.gitignore` leaves out stay on your computer), or the GitHub App downloads the branch head.
2. **Inventory**: every file, honouring `.gitignore`.
3. **Dependencies**: manifests and lockfiles across npm, PyPI, Go, crates.io, RubyGems, Packagist, Maven, NuGet, Hex and Pub.
4. **Vendors**: every outside service, from packages, env names, addresses, config files and Stripe Projects.
5. **Checks** (Proven): committed keys, repository hygiene, OSV vulnerabilities, versions behind.
6. **Docs check** (Doc-verified, optional): a main package's own documentation against how the code imports it, cited.
7. **Rank**: deterministic ordering and de-duplication.
8. **Read the accounts**: queued after every map, and every hour by the worker.

The uploaded snapshot is deleted as soon as its map has run. Every step writes to an append-only event log that the web app, the terminal and the MCP server replay live.

## History

Built at the Supabase Select Hackathon at YC (October 2026). See `HACKATHON.md`.

## Contributing and security

See `CONTRIBUTING.md` and `SECURITY.md`.

## License

Mozilla Public License 2.0. See `LICENSE`.
