# birdsI

A bird's-eye codebase auditor. birdsI reads a whole codebase and all of its dependencies, finds gaps, security holes, contradictions and inconsistencies, checks them against current documentation, and either fixes them with a pull request you approve or explains what you need to do in plain steps.

Built for people who ship real apps with GitHub and AI coding tools and do not read code fluently. Technical developers get the same depth with no handicaps.

**Live demo:** https://birdsi.vercel.app (scan a sample repository without signing in)

## What it does

Every finding carries one of three confidence classes, shown everywhere:

| Class | Meaning |
|---|---|
| Proven | A deterministic tool or rule established it (secret scanner, OSV vulnerability database, repository hygiene rules). |
| Doc-verified | Checked against a current official document found at scan time, which is cited with the passage. |
| Judgment | The model's reading of the code. Usually right, worth a look before acting. |

Three scan tiers:

- **Light scan** (about a minute): secrets, repository hygiene, known vulnerabilities, package freshness, docs checks for the main packages, and a model read of the highest-impact files.
- **Deep scan** (several minutes): the same, over the whole codebase, plus a cross-file pass for contradictions.
- **Pre-launch audit**: the deep scan plus a verdict across eight areas (sign-in and permissions, keys, user data, packages, failure handling, deployment settings, legal pages, tests).

Fixes are tested in an isolated sandbox before a pull request is opened. Findings that need an action outside the code come with numbered steps.

Three surfaces share one engine:

- the **web app** (dashboard, findings, dependency table, chat about the codebase, pre-launch audit),
- the **`birdsi` terminal tool** (`npx birdsi scan`), and
- an **MCP server** (`npx birdsi mcp`) so Claude Code, Cursor and Codex can call birdsI mid-session.

## Nemotron and Token Factory

birdsI runs on [Nebius Token Factory](https://tokenfactory.nebius.com) with NVIDIA's open Nemotron 3 models, called live during every scan:

| Model | Used for |
|---|---|
| Nemotron 3 Nano | light scans, chat, docs comparisons |
| Nemotron 3 Super | deep scans, the cross-file pass, writing fixes |
| Nemotron 3 Ultra | the pre-launch audit verdict |

The `-fast` flavor serves interactive work; the base flavor serves background scans. Fixes are verified in [Token Factory Sandboxes](https://docs.tokenfactory.nebius.com/sandboxes/overview) before a pull request is opened. Qwen3 embeddings from Token Factory power code-aware chat.

Other services: [Tavily](https://tavily.com) fetches current documentation, changelogs and advisories per dependency at runtime; [OSV](https://osv.dev) and [deps.dev](https://deps.dev) provide vulnerability and version data; [LangSmith](https://smith.langchain.com) traces every scan when configured.

## Repository layout

```
apps/web         Next.js 16 web app and the /api/v1 API (Vercel)
apps/worker      background worker that runs scans and fixes (any Node host)
packages/engine  the scan engine: source adapters, inventory, checks, fixes, chat
packages/shared  domain types, API schemas, UI copy
packages/db      Supabase data access, job queue, usage ledger
packages/cli     the `birdsi` CLI and MCP server (published to npm)
supabase/        database migrations
samples/         the sample repository used by the no-install demo
```

## Setup

Requirements: Node 22 or newer, a Supabase project, a Clerk application (GitHub sign-in), a Nebius Token Factory API key. Tavily, LangSmith and a GitHub App are optional; features that need them switch off cleanly when their keys are absent.

```bash
git clone https://github.com/yasmeen-khalil/birdsI.git
cd birdsI
npm install
cp .env.example .env.local     # fill in the keys; apps/web/.env.local is a symlink to it
```

Database: apply `supabase/migrations/*.sql` to your Supabase project (Supabase CLI: `supabase link` then `supabase db push`, or paste the file into the SQL editor).

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
| `NEBIUS_API_KEY` | Token Factory inference (required) |
| `NEBIUS_AI_PROJECT` | Token Factory project id, enables Sandboxes fix testing |
| `TAVILY_API_KEY` | current docs lookups (the docs check is skipped without it) |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | database and storage |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | sign-in |
| `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET` | connecting repositories and opening pull requests |
| `LANGSMITH_TRACING`, `LANGSMITH_API_KEY`, `LANGSMITH_PROJECT` | tracing |

Model ids are overridable (`BIRDSI_MODEL_NANO`, `BIRDSI_MODEL_SUPER`, `BIRDSI_MODEL_ULTRA`, `BIRDSI_MODEL_EMBEDDING`).

### Deploying

- **Web app:** Vercel, root directory `apps/web`, build from the monorepo root (`npm run build --workspace=apps/web`). Set the environment variables above.
- **Worker:** any host that runs a long-lived Node process (Railway, Fly.io, a VM). `apps/worker/Dockerfile` builds it from the repository root. It needs the same environment variables minus the Clerk keys. Run more than one instance for parallel scans; the queue claim is safe across workers.
- **GitHub App:** permissions Contents (read and write), Pull requests (read and write), Metadata (read); webhook events `installation` and `installation_repositories` to `/api/github/webhook`; setup URL `/github/setup` with "redirect on update" on.

## Terminal and MCP

```bash
npx birdsi login          # sign in through the browser
npx birdsi scan           # light scan of the current folder
npx birdsi scan --deep    # deep scan
npx birdsi scan --audit --describe "what the app does"
npx birdsi mcp            # MCP server over stdio for coding agents
```

See `packages/cli/README.md` for every command, option and exit code, and the MCP configuration snippets for Claude Code, Cursor and Codex.

## How a scan works

1. **Fetch**: the GitHub App downloads the repository at the branch head, or the CLI uploads a snapshot of the working tree.
2. **Inventory**: every file is mapped, honouring `.gitignore`; files are prioritised by how much they affect security and correctness.
3. **Dependencies**: manifests and lockfiles across npm, PyPI, Go, crates.io, RubyGems, Packagist, Maven, NuGet, Hex and Pub.
4. **Deterministic checks** (Proven): committed secrets, repository hygiene, OSV vulnerabilities, versions behind.
5. **Docs check** (Doc-verified): Tavily finds current documentation for the main packages; Nemotron compares it with how the code uses them and must cite the passage.
6. **Review** (Judgment): Nemotron reads the prioritised files for security holes, gaps and inconsistencies, then a cross-file pass looks for contradictions.
7. **Rank**: deterministic ordering and de-duplication; the summary says what to start with.
8. **Audit** (pre-launch only): a verdict per area.

Every step writes to an append-only event log that the web app, the CLI and the MCP server replay live.

## Hackathon

Built for the Nebius x NVIDIA Global AI Hackathon, track: Coding and Agentic Engineering. See `HACKATHON.md` for the submission notes and feedback on the tools.

## Contributing and security

See `CONTRIBUTING.md` and `SECURITY.md`.

## License

Mozilla Public License 2.0. See `LICENSE`.
