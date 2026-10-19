# Changelog

## v3 (2026-10-18, unreleased): the cockpit

birdsI becomes the cockpit for its owner's apps: one page per app, read from the code and from the vendors' own APIs, and what needs the owner. Built in checkpoints, each with the full chain green.

### Step 1: the cut

Removed, with their routes, screens, strings, tests and dependencies:
- The model-driven code audit: the model review (Judgment findings), the cross-file pass, the Pre-launch audit and its page, fixes and pull requests, sandbox testing, chat and its code index. `birdsi fix`, `birdsi ask`, `birdsi_fix` and `birdsi_ask` are gone, and so are `--full`, `--deep`, `--audit`, `--describe` and the fix prompts.
- The hackathon scaffolding: the Nemotron provider, Token Factory embeddings and Sandboxes, LangSmith tracing, the sample bakery app and its no-sign-in demo. `openai` and `langsmith` left the dependencies.
- Plan tiers read from pricing pages by a model every week, and the questions that asked the owner to type a plan or a dashboard number.
- Nothing was dropped from the database: `20261018000000_v3_retire_audit.sql` marks the retired tables (chat messages, code passages, fixes, the pricing cache) and keeps every row.

What replaced them:
- One kind of run: a map of the code. `npx birdsi` and `birdsi map` (also `birdsi scan`) map the app in about a minute. No model reads the code. The rule-based checks stay (committed keys, unsafe settings, OSV vulnerabilities, packages far behind), and the docs check stays, optional, on Claude only, citing the package's own documentation.
- A checked limits list (`packages/shared/src/limits.ts`): sixteen vendors, each plan's limits, what ends it and the next price, read on 18 October 2026 from each vendor's own page, every number with the page's exact words. Two records it corrected: OneSignal's free plan sends mobile push only under 1,000 monthly active users since 1 October 2026, and Resend's free plan allows 3 domains.
- The read job writes the plan's checked limits as facts citing the page and the date, and alerts compare usage with them.
- `supabase/verify.sql`: one read-only query that says which of birdsI's own migrations have run.

Fixed:
- Uploaded code was kept seven days for fixes that no longer exist. It is now deleted as soon as its map has run, and within a day if the map never starts.
- Monthly spend no longer adds a plan's list price to money read from accounts.
- The Vercel connector no longer calls a personal account Hobby without reading it.
- Stripe revenue reads every page of the month's charges (up to 1,000) and takes refunds off, instead of the first 100 with refunds counted.
- The landing page and footer linked to a private repository and an unpublished package. The links are gone, and the privacy page and terms point to the operator on GitHub.
- `changes` leaves the removed model review's findings out, so they never show as resolved after the cut.
- The privacy page, terms and security policy describe what v3 does.

## v2 (2026-10-03, unreleased)

The operations record for an app, built for coding agents.

### Since the submission (from 2026-10-04)

Trust, before any user beyond the owner:
- The terminal tool never uploads `.env` files, private keys, certificates or credential files, whatever `.gitignore` says.
- Uploaded snapshots are kept seven days, then deleted by an hourly sweep, and deleted at once with the account. The privacy page and SECURITY.md say exactly that.
- Approvals are decided in the browser only. A bearer token (the one an agent holds) is refused.
- `approvals run` only runs allowlisted programs (stripe, npm, npx, pnpm, yarn, bun, vercel, supabase, railway, fly, flyctl, gh, git, node), with a minimal environment, each after a yes.
- Text read from the repository or the web is marked between « and » in every agent-facing result.
- A per-user daily spend cap (default $5) beside the global one (default $50). The no-sign-in demo replays a finished run from the last six hours instead of starting a new one.
- gitleaks in CI, and `sk-ant-`, `bsi_` and `rk_` shapes in the pre-commit hook.

Cheaper and faster scans:
- The repository digest and context notes are cached by the provider across a scan's calls (prompt caching).
- Files unchanged since the last finished scan keep that scan's findings instead of being read again, in every tier. The review emits an index of file hashes for the next scan.
- Vendors are stored the moment they are found, so the inventory is visible within the first half minute of a scan.
- The bare `birdsi` is the Quick check and `--full` the Full scan (since 2026-10-05). Every time claim matches the measured runs.

Usage made real:
- Supabase: database size, file storage and monthly active users read with read-only SQL through the Management API, against the plan's allowances.
- Anthropic: cost and usage reports read in full (paginated), cached tokens counted.
- Usage the owner typed expires after thirty days and is asked again.
- A daily vendor sync at 06:00 UTC (`/api/cron/sync`, behind `CRON_SECRET`) for every repository whose vendors were synced more than twenty hours ago. Replaced on 2026-10-06 by the worker's own schedule, below.

Built for agents:
- `birdsi inventory` and `birdsi changes`, both with `--json`. The read commands take `--json`.
- MCP: `birdsi_changes_since` (new and resolved findings by stable key). `birdsi_inventory`, `birdsi_vendor` and `birdsi_changes_since` return structured content as well as text. `birdsi_scan` returns after four minutes if the scan is still running.
- `GET /api/v1/repos/:id/changes?since=<scanId>`.
- A skill, `skills/birdsi/SKILL.md`, that tells an agent when to read birdsI and how to read its facts.
- `birdsi mcp --install-hint` pins the version and puts no token in any file.
- The docs check only reads the package's own documentation: domains from the registry record (npm, PyPI, crates.io, and the repository for Go), GitHub only for the package's repository and advisories. A package without a known official source is reported as unknown, not checked against a blog post.

Faster, and the worker keeps its own clock (2026-10-06):
- The review and the docs check run several model calls at once (4 on quick checks, 3 on full scans, `BIRDSI_SCAN_CONCURRENCY`). The budget is checked before every call.
- The worker schedules vendor syncs itself: hourly for owners with a connected account, daily for everyone. No outside cron and no secret to set. `/api/cron/sync` stays as a manual trigger.
- A priority lane: quick checks, demo scans and fixes are claimed before full scans and syncs (migration `20261006000000_queue_priority_workers.sql`).
- Worker presence: each worker reports in every half minute, and a queued scan says plainly when no scanner has reported in for two minutes instead of "starts in a moment".
- Code deployed before a migration runs keeps working: new columns and tables are probed and used once they exist.
- The terminal tool says when a feature waits on a database migration the operator has not run, instead of a generic server error.

The record (2026-10-06):
- Every change outside the code now has an author and a reason, in one append-only record per app: decisions, facts stated, findings marked fixed, dismissed or reopened, fixes started, the vision, the policy, questions answered or dismissed, commands approved or denied, and what happened when they ran.
- Agents write to it within the owner's policy (a toggle on the Agent page, on by default): `birdsi_record_decision`, `birdsi_record_fact`, `birdsi_mark_fixed`. A fact an agent states carries the source "Your coding agent told birdsI" and is outranked by the connected account and by the owner. A fixed mark is judged by the next scan.
- Reads: `birdsi_record` and `npx birdsi record --json`. The inventory carries the latest twenty decisions so an agent never asks what was already decided. The owner writes with `npx birdsi decide` and `npx birdsi fixed`, and reads the record on the Agent page.
- `GET` and `POST /api/v1/repos/:id/record`, `POST /api/v1/findings/:id/fixed`. Migration `20261006000100_record.sql`.

Policy as a rule at the shell (2026-10-06):
- `birdsi policy` shows the repository's agent policy, and `birdsi policy check` is a Claude Code PreToolUse hook (`birdsi policy --hint` prints the snippet). A command that changes a vendor account (Stripe, Vercel, Supabase, Railway, Fly.io, GitHub secrets, variables, releases and repository deletes, npm publish and package ownership) is stopped with the reason and the agent is told to propose it through birdsI. Reads, status, logs and local work pass without a network call. `GET /api/v1/repos/:id/policy`.

Measured and corrected (2026-10-06):
- A repeat quick check of a 546-file repository takes 21 seconds and costs $0.04. The first after a change reads every changed file (311 seconds and $0.70 for 40 files on the first run). The scan stats now carry `cachedTokens`.
- Cached input was priced as uncached. Reads now cost a tenth and cache writes a quarter more, in the ledger, the spend caps and the stats.
- The review reports at most four findings per file, short and exact, which halves the output half of each call and removes most repair calls.

Security round (2026-10-13):
- Spending limits hold while work runs. The worker checks the daily cap for everyone and for each person at the start of every job and before every model call, so a scan stops when the limit is reached instead of running past it.
- A fix can only read and change files inside the code it was written for. A path that points outside it is refused.
- A GitHub installation belongs to the account that connected it first. The install link is signed for the person who started it, and an installation id in a link can never move repositories to someone else.
- Each scan keeps at most 60 vendors, and at most 10 that are not in the catalog, since each one can cost web searches and a model call.
- The job queue is fenced: a worker that lost a job writes nothing about it, and a job that keeps stopping its worker is failed instead of retried forever.
- Environment files and credential files never leave the computer, even when a `.gitignore` tries to bring them back. The MCP server only uploads the folder it was started in, or the git repository around it.
- Anything shaped like a known key is masked before it is stored or shown: vendor call sites, code excerpts and chat passages. A private key block is removed whole.
- Text read from a repository or the web is marked between « and » in every result an agent reads.
- Deleting an account removes everything it owns and keeps only an empty, marked-deleted shell, so the spending already counted today still counts if the same person signs in again.

Wording and the Demo tag (2026-10-13):
- The word Demo sits at the top right of every page while birdsI is a demo, on phones too, including the legal pages, sign-in, connect and the 404 page.
- One voice everywhere: no emojis, em dashes, semicolons or exclamation marks, short buttons, and the product's own nouns. The copy guard test catches semicolons and exclamation marks as well as em dashes.
- Every screen and document says what the code does today: scans read up to 400 files and audits up to 600, the vision is read by agents and by chat, and a fix is tested in a sandbox only when sandbox testing is set up, otherwise the pull request says so.
- A scan from the terminal offers to apply each fix to your files and no longer asks about a pull request it cannot open.

### The 2026-10-03 release

- Vendors: every outside service found from packages, env names, URL domains, config files and Stripe Projects state. Unknown services are named from their env var, and what each is used for comes from the call sites.
- Connectors for Vercel, Supabase, Stripe, Anthropic, Tavily, Supadata and Resend: plan, usage, limits, spend, read with a token the owner connects once (tested before saving, encrypted at rest).
- Vendor knowledge: what a service is and its plan tiers, read from its current pricing page and cached for a week. The plan's limits become facts with the source cited.
- Alerts at 80% and 95% of any limit, computed at read time, with the Stripe Projects command that fixes it.
- Questions: what birdsI cannot know is asked once, in one queue, and answers become facts. Agents ask there too.
- Approvals: agents propose plain commands, the owner approves, and the terminal tool runs them on the owner's machine and reports back. A per-repository policy with an optional auto-approve threshold.
- Vision: the owner's words, read by agents and by chat.
- A pipeline in dependency order with freshness per stage, and one Full scan button. `birdsi` with no command ran it and opened the dashboard (the Quick check since 2026-10-05).
- Claude (Haiku 4.5, Opus 5.5, Fable 5.1) behind the same model door as Nemotron, selected by key. Embeddings come from Token Factory when its key is present, and chat searches by keywords otherwise.
- Local repositories: snapshots from the terminal belong to a repository, so the dashboard, chat, vendors and questions work without the GitHub App.
- CLI: `vendors`, `questions`, `approvals`, `vision`, `export`. MCP: `birdsi_inventory`, `birdsi_vendor`, `birdsi_vision`, `birdsi_questions`, `birdsi_ask_owner`, `birdsi_request_action`, `birdsi_action_status`, `birdsi_sync_vendors`.
- Web: Vendors and Agent pages, the pipeline strip, alerts, vision editor, connected accounts in Settings.
- Trackers for what might happen (a free plan that pauses, a trial that ends), runway for usage that grows toward a limit, and a ninth audit area, Services and limits, judged by rule from the alerts.
- The light theme, with Newsreader, Geist and Geist Mono type.
- Chat helps with the product and the project, not only the code, and the connect page leads with the terminal.
- Schema: vendors, vendor_facts, vendor_knowledge, connections, questions, action_requests, agent_policies. Repos gain source, vision and sync time, and a grants migration for the server role.

## v1 (unreleased)

First complete build.

- Scan engine: inventory with `.gitignore` support, dependency manifests across ten ecosystems, deterministic checks (secrets, repository hygiene, OSV vulnerabilities, package freshness), a Tavily-backed docs check, Nemotron code review and cross-file pass, ranking, and the pre-launch audit.
- Confidence classes on every finding: Proven, Doc-verified, Judgment.
- Fixes: model-written edits applied in memory, tested in a Token Factory Sandbox when one is set up, opened as a pull request through the GitHub App, and patches for CLI snapshots.
- Web app: landing page, no-install demo scan, GitHub sign-in through Clerk, repository connection through a GitHub App, overview with the bird's-eye map, findings, finding detail with fix flow, dependency table, chat about the codebase, pre-launch audit, settings with account deletion, CLI device sign-in approval.
- Public API `/api/v1` with bearer tokens.
- Worker with a Postgres-backed job queue (safe across multiple workers), heartbeats and stop requests.
- `birdsi` CLI with device sign-in, snapshot upload, live progress, fix prompts and local patch application. MCP server over stdio with scan, status, findings, finding, fix and ask tools.
- Supabase schema with row level security on every table, an append-only usage ledger and scan event log.
