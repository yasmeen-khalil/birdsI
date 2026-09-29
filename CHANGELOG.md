# Changelog

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
