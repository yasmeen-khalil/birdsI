# birdsI

The cockpit for your apps. birdsI maps each app from its code: the services it runs on, its deployments, crons, webhooks, store apps, migrations and the settings each deployment needs. Then it reads the vendor accounts with keys that only read, and tells you what needs you. Nothing a model says reaches you unverified: the map is read by rules that cite the file and line, and the one model call today, the optional docs check, must cite the package's own documentation.

Run `npx birdsi` in an app's folder and its cockpit opens: what needs you, the services and dependencies by what each is for with its docs and its key, the live reads of each Vercel project, Supabase project and OneSignal app, the last map and what it checked, security with every finding's severity under an honest scope statement, money as far as it is known (spend read from the accounts, list prices where no spend is read, and what you entered for what no API reports), and the code's crons, webhooks, store apps, migrations and public pages. The Set up page lists what birdsI still needs from you, service by service: the project to declare, the key to make with the exact clicks, what each key lets birdsI read and alert on, and what birdsI may do with it (read only in this phase). Until the package is on npm, run it from a clone: `npm install`, then `npx tsx packages/cli/src/birdsi.ts`.

birdsI is its owner's cockpit for their own apps first. A product for others comes later.

## What it does

- **The map, from the code.** Every outside service the app uses, found by rules from packages, imports, env names, web addresses and config files, each with the file and line it came from. The service map with it: the env names each deployment needs (by the role names the code compares, such as `APP_ROLE`), the crons and whether their handlers check the secret, the webhooks and the line that verifies each, the store apps, the migrations the repository holds and its public pages. It names env variables and never reads a value. Each map is kept, dated, with its commit. Then the model reads the code for what the rules missed, and every find it makes is confirmed at its file and line before it joins the map, marked as the model's. It also writes what the app uses each service for, in one sentence, marked as its reading. On the next map only the files that changed are read again. Rule-based checks run with it: committed keys, unsafe settings, published vulnerabilities (OSV), packages two or more majors behind, and the map against itself (crons without a handler or a secret check, webhooks without a sender check, an SDK with no key named, env names nothing reads, packages nothing imports, files no route reaches, two services for one job). Every map ends with what it checked and what it did not. When its keys are set, the docs check compares a main package's own current documentation with how the code imports it, and must cite the page.
- **Apps and their projects.** Each app is a record with the vendor projects it has: one Vercel project per deployment, the Supabase project, the OneSignal app, and the rest. A key belongs to one project, only reads, is checked with the vendor before it is stored, and is never shown again.
- **What the accounts say.** With those keys, birdsI reads each project every hour. A Vercel project: its deployments with their state and age, its env names and where each applies (never a value), its crons, its domains, and the error lines of a failed build and of its functions. A Supabase project: whether it is paused, its database size, the security and performance advisors, and which of the app's migrations its database still lacks (from the markers in the app's own `verify.sql`, checked against the database's structure, never its rows). A OneSignal app: its subscriptions, the platforms it sends to, whether mobile push is being dropped for the plan, and its recent messages with their delivery counts. Every part is dated with the address it came from. A part birdsI could not read says why, and is never shown as zero.
- **The checked limits list.** What each vendor's plans include, what ends them and the next price, read by a person from each vendor's own pricing page, dated and quoted (`packages/shared/src/limits.ts`). A model never reads a pricing page.
- **The alert stream.** Every hour each app is checked from its map and its reads, and what needs you is stored as one alert per cause: a paused database, a failed production deployment, a cron Vercel does not run, an env name a deployment's code reads that its Vercel project lacks, a migration the database still owes, a plan at 80 or 95 percent of a limit (or a cron more frequent than the plan allows, or mobile push dropped for the plan), a date coming up (a key that expires, a trial that ends, a renewal you entered), a project that could not be read, a pricing page that no longer says what the checked limits list rests on. Each is one sentence: the object, who or what acted, the rule with its numbers, and the result, with where the evidence is. An alert closes by itself when a later read no longer finds its cause. New alerts are emailed through Resend when birdsI has a key for it and you turn email on, and each alert says whether it was emailed. A condition that might happen (a free plan that pauses) is a tracker, never an alert.
- **Approvals and the record.** Your coding agent proposes a command, you approve it in the browser, it runs on your own computer. Every decision, fact, approval and run lands in an append-only record with its author.

## Built for agents

A coding agent can read the code. It cannot see what the app runs on or what the owner decided. birdsI hands it that, through three doors:

1. **A skill.** `skills/birdsi/SKILL.md` tells an agent when to read birdsI and how to read its facts.
2. **The terminal tool with `--json`.** `npx birdsi inventory --json`, `changes --json`, `vendors --json`, `questions --json`, `record --json`.
3. **The MCP server.** `npx birdsi mcp`: `birdsi_inventory`, `birdsi_cockpit`, `birdsi_setup`, `birdsi_alerts`, `birdsi_changes_since`, `birdsi_vendor`, `birdsi_vision`, `birdsi_questions`, `birdsi_ask_owner`, `birdsi_request_action`, `birdsi_action_status`, the record tools, the findings tools, and the map and read tools.

An agent can ask the owner and propose, and only the owner approves, in the browser. `npx birdsi policy --hint` prints a Claude Code hook that stops account-changing shell commands and routes them through approvals.

## Models

Two sizes of model sit behind one door: a small one for reading and the docs check, a large one for verification. On Nebius Token Factory they are NVIDIA Nemotron 3 Nano (`nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`) and Nemotron 3 Super (`nvidia/nemotron-3-super-120b-a12b`), called through Token Factory's OpenAI-compatible API with its JSON schema output. On Anthropic they are Claude Haiku 4.5 and Claude Opus 5.5. The key you set picks the provider, Nemotron first when both are set, `BIRDSI_PROVIDER` forces one, and `BIRDSI_MODEL_NANO` and `BIRDSI_MODEL_SUPER` override the ids. The small model reads the code after the rules and runs the docs check. Nothing a model says reaches you unverified: a find is confirmed at its line or dropped, and a purpose is marked as the model's reading.

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

Requirements: Node 22 or newer, a Supabase project, a Clerk application (GitHub sign-in). A model key (`NEBIUS_API_KEY` for Nemotron on Nebius Token Factory, or `ANTHROPIC_API_KEY` for Claude) and a Tavily key are optional: together they switch on the docs check. A GitHub App is optional.

The repository is private today. Making it public is the owner's decision. With access:

```bash
git clone https://github.com/yasmeen-khalil/birdsI.git
cd birdsI
npm install
cp .env.example .env.local     # fill in the keys. apps/web/.env.local is a symlink to it
```

Database: apply every file under `supabase/migrations/` to your Supabase project, in filename order (paste each into the SQL editor, or `supabase db push`), thirteen files today. Then paste `supabase/verify.sql` and run it: every row should say OK.

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
| `NEBIUS_API_KEY` or `ANTHROPIC_API_KEY`, and `TAVILY_API_KEY` | optional: the docs check, skipped without a model key and Tavily |
| `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET` | optional: reading repositories through the GitHub App |

### Deploying

- **Web app:** Vercel, root directory `apps/web`, build from the monorepo root (`npm run build --workspace=apps/web`).
- **Worker:** any host that runs a long-lived Node process (Railway, Fly.io, a VM). `apps/worker/Dockerfile` builds it from the repository root. It needs the same environment variables minus the Clerk keys.
- **GitHub App (optional):** permissions Contents (read) and Metadata (read), nothing that writes. Webhook events `installation` and `installation_repositories` go to `/api/github/webhook`. The setup URL is `/github/setup`, with "redirect on update" on.

## Terminal and MCP

```bash
npx birdsi login          # sign in through the browser
npx birdsi                # map the app in the current folder, then open its page
npx birdsi cockpit        # the app now: open alerts, each project as last read, the map
npx birdsi alerts         # the alert stream, the closed alerts and the dates to watch
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
5. **Service map**: the import graph from each route, the deployments and the env names each one reaches, crons from `vercel.json`, webhooks, store apps from Capacitor, Xcode, Gradle and Expo config, migrations with `verify.sql` markers, the sitemap, robots and `llms.txt`. Only example env files are read, for names and comments.
6. **Checks** (Proven): committed keys, repository hygiene, OSV vulnerabilities, versions behind.
7. **Docs check** (Doc-verified, optional): a main package's own documentation against how the code imports it, cited.
8. **Rank**: deterministic ordering and de-duplication.
9. **Read the accounts**: queued after every map, and every hour by the worker.

The uploaded snapshot is deleted as soon as its map has run. Every step writes to an append-only event log that the web app, the terminal and the MCP server replay live.

## History

Built at the Supabase Select Hackathon at YC (October 2026). See `HACKATHON.md`.

## Contributing and security

See `CONTRIBUTING.md` and `SECURITY.md`.

## License

Mozilla Public License 2.0. See `LICENSE`.
