# Hackathon submission notes

## Supabase Select Hackathon at YC, 3 October 2026

**What was built that day:** the operations record for an app, built for coding agents. birdsI already audited code. That day it learned everything outside the code that makes an app run, and became something a coding agent can act through. (Since v3, 18 October 2026, birdsI is the cockpit for its owner's apps, and the code audit is gone.)

- **Vendor inventory**, deterministic: packages, env names, URL domains, config files and Stripe Projects state. Purposes written by Claude Haiku from the call sites.
- **Connectors** for Vercel, Supabase, Stripe, Anthropic, Tavily, Supadata and Resend: plan, usage, limits, spend, read with a token the owner pastes once (encrypted at rest).
- **Vendor knowledge** from current pricing pages through Tavily, extracted into tiers by Haiku, cached for a week.
- **Alerts** at 80% and 95% of any limit, with the Stripe Projects command that fixes it.
- **Questions** only a person can answer, in one queue, answerable in the dashboard or the terminal.
- **Approvals**: agents propose commands, the owner approves, and the command runs on the owner's machine through the CLI and reports back. A per-repository policy can auto-approve small, allowed commands.
- **Vision**: the owner's words, read by agents and by chat.
- **A pipeline in dependency order** with freshness per stage, one Full scan button, and `npx birdsi` as the one command that runs it and opens the dashboard (since 2026-10-05 the bare command is the quick check and `--full` the full scan).
- **MCP tools** for all of it (20 today, listed in `packages/cli/README.md`).
- **Claude** as the model behind the one model door (Haiku 4.5, Opus 5.5, Fable 5.1), with Nemotron on Token Factory still a switch away.

**Supabase in birdsI:** Postgres holds every table (repos, scans, findings, vendors, facts, knowledge, questions, actions, policies, connections). pgvector holds code chunks for chat. Storage holds uploaded snapshots. Postgres functions run the job queue (`claim_job` with SKIP LOCKED) and vector search. Every table has RLS on, and the service key never leaves the server.

**Stripe in birdsI:** Stripe Projects is a first-class source (state file, status, spend) and the execution path for approved upgrades. The Stripe connector reads balance and this month's revenue so costs and revenue sit together.

**Vercel in birdsI:** the web app and API run on Vercel. The Vercel connector reads the team plan, resource limits and billing charges.

**Judges' account:** sign in with GitHub at the demo URL, then run `npx birdsi` in any project (or the bundled sample) to see it fill.

Until the package is on npm, run it from a clone: `npm install`, then `npx tsx packages/cli/src/birdsi.ts`. The repository is private today, so a clone needs access from the owner.

## Nebius x NVIDIA Global AI Hackathon

birdsI was prepared for this hackathon's Coding and Agentic Engineering track, with Nemotron models on Nebius Token Factory, Token Factory embeddings and Sandboxes, and LangSmith tracing. On 18 October 2026 the owner chose to stop protecting that entry, and that code was removed in v3 with the model-driven code audit. The history keeps it.

On 27 October 2026 the owner reopened the entry in this repository, cloned from v3 and renamed `birdsI` (the development record up to v3 is kept at `birdsI-beta`): the same cockpit, with Nemotron on Token Factory as the model that reads the code behind a verifier, prepared for the Best Apps and Agents track. The submission's own section replaces this note when the entry is ready.
