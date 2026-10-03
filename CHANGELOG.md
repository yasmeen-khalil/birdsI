# Changelog

## v2 (2026-10-03, unreleased)

The operations layer for coding agents.

- Vendors: every outside service found from packages, env names, URL domains, config files and Stripe Projects state; unknown services named from their env var; what each is used for, from the call sites.
- Connectors for Vercel, Supabase, Stripe, Anthropic, Tavily, Supadata and Resend: plan, usage, limits, spend, read with a token the owner connects once (tested before saving, encrypted at rest).
- Vendor knowledge: what a service is and its plan tiers, read from its current pricing page and cached for a week; the plan's limits become facts with the source cited.
- Alerts at 80% and 95% of any limit, computed at read time, with the Stripe Projects command that fixes it.
- Questions: what birdsI cannot know is asked once, in one queue; answers become facts. Agents ask there too.
- Approvals: agents propose plain commands; the owner approves; the terminal tool runs them on the owner's machine and reports back. A per-repository policy with an optional auto-approve threshold.
- Vision: the owner's words, read by agents and audits.
- A pipeline in dependency order with freshness per stage; one Full scan button; `birdsi` with no command runs it and opens the dashboard.
- Claude (Haiku 4.5, Opus 5.5, Fable 5.1) behind the same model door as Nemotron, selected by key; embeddings from Token Factory when its key is present, keyword retrieval otherwise.
- Local repositories: snapshots from the terminal belong to a repository, so the dashboard, chat, vendors and questions work without the GitHub App.
- CLI: `vendors`, `questions`, `approvals`, `vision`, `export`. MCP: `birdsi_inventory`, `birdsi_vendor`, `birdsi_vision`, `birdsi_questions`, `birdsi_ask_owner`, `birdsi_request_action`, `birdsi_action_status`, `birdsi_sync_vendors`.
- Web: Vendors and Agent pages, the pipeline strip, alerts, vision editor, connected accounts in Settings.
- Schema: vendors, vendor_facts, vendor_knowledge, connections, questions, action_requests, agent_policies; repos gain source, vision and sync time; a grants migration for the server role.

## v1 (unreleased)

First complete build.

- Scan engine: inventory with `.gitignore` support, dependency manifests across ten ecosystems, deterministic checks (secrets, repository hygiene, OSV vulnerabilities, package freshness), a Tavily-backed docs check, Nemotron code review and cross-file pass, ranking, and the pre-launch audit.
- Confidence classes on every finding: Proven, Doc-verified, Judgment.
- Fixes: model-written edits applied in memory, tested in a Token Factory Sandbox, opened as a pull request through the GitHub App; patches for CLI snapshots.
- Web app: landing page, no-install demo scan, GitHub sign-in through Clerk, repository connection through a GitHub App, overview with the bird's-eye map, findings, finding detail with fix flow, dependency table, chat about the codebase, pre-launch audit, settings with account deletion, CLI device sign-in approval.
- Public API `/api/v1` with bearer tokens.
- Worker with a Postgres-backed job queue (safe across multiple workers), heartbeats and stop requests.
- `birdsi` CLI with device sign-in, snapshot upload, live progress, fix prompts and local patch application; MCP server over stdio with scan, status, findings, finding, fix and ask tools.
- Supabase schema with row level security on every table, an append-only usage ledger and scan event log.
