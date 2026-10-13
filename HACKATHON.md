# Hackathon submission notes

## Supabase Select Hackathon at YC, 3 October 2026

**What was built today:** the operations record for an app, built for coding agents. birdsI already audited code. That day it learned everything outside the code that makes an app run, and became something a coding agent can act through.

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

**Event:** Nebius x NVIDIA Global AI Hackathon
**Track:** Coding and Agentic Engineering
**Bonus award entered:** Best Use of Tavily (runtime Tavily calls in every scan's docs check)

## Where Nebius and NVIDIA are used

The hosted demo at https://birdsi.vercel.app runs on Claude. Nemotron runs on a deployment that sets only `NEBIUS_API_KEY`, or sets `BIRDSI_PROVIDER=nebius`, through the same model door. With both keys, Token Factory still provides the embeddings and, when `NEBIUS_AI_PROJECT` is set, the Sandboxes.

- **Nemotron 3 Nano** (`nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`): light scans, docs comparisons, chat, fix explanations.
- **Nemotron 3 Super** (`nvidia/nemotron-3-super-120b-a12b`): deep scan file reviews, the cross-file contradiction pass, writing fixes.
- **Nemotron 3 Ultra** (`nvidia/Nemotron-3-Ultra-550b-a55b`): the pre-launch audit verdict.
- **Token Factory inference** through the OpenAI-compatible API with JSON schema structured output, fast flavor for interactive work and base flavor for background scans.
- **Token Factory Sandboxes**: when `NEBIUS_AI_PROJECT` is set, every fix is applied to a copy of the repository and the project's own test or typecheck command runs in an isolated VM before a pull request opens. Without it, the pull request says the change was not run.
- **Token Factory embeddings** (Qwen3-Embedding-8B): code chunks embedded for chat retrieval.

Code: `packages/engine/src/models/client.ts` (inference), `packages/engine/src/fix/sandbox.ts` (Sandboxes), `packages/engine/src/checks/docs.ts` (Tavily).

## Trying it

- Live demo: https://birdsi.vercel.app, press "Try the sample". No sign-in.
- Sign in with GitHub, then add a repository from your terminal.
- Terminal: `npx birdsi` in any project runs the quick check, and `--full` runs the full scan. `npx birdsi inventory --json` and `npx birdsi changes --json` are the reads built for agents.
- MCP: `npx birdsi mcp --install-hint` prints the configuration for Claude Code, Cursor and Codex. `skills/birdsi/SKILL.md` tells an agent when to read birdsI.

## Feedback on the tools

Written after the build, and kept factual so it is useful to the teams.

**Token Factory**
- The OpenAI-compatible API made integration a matter of a base URL. Structured output with `json_schema` worked as documented. Repeating the schema in the prompt, as the docs suggest, noticeably improved compliance on the smaller model.
- The `-fast` suffix for the interactive flavor is a clean design. A per-model capability matrix (JSON mode, tool calling, max output tokens) in one table would have saved trial calls.
- Pricing tables are rendered client-side, so they are not readable by tools that fetch the page. A plain text or JSON version would help builders who script cost estimates.

**Sandboxes**
- The file upload plus `/instances` spawn model is simple and the operation polling with `Retry-After` is considerate. Documentation of the REST API is complete in the OpenAPI spec but the human-readable guides centre on the Python SDK and CLI. A short REST walkthrough (upload, spawn, poll, read stdout) would help non-Python users.
- The list of publicly available image tags is only reachable with a key. Publishing it would let builders choose images before signing up.

**Nemotron**
- Nano is fast and reliable for structured tasks with tight prompts. Super produced high-quality code edits with the search-and-replace format. The models responded well to explicit "return an empty list if nothing is wrong" instructions, which matters for an auditor that must not invent problems.

**Tavily**
- Search with `include_domains` and a small `max_results` gives exactly the current documents needed for a docs check, and `published_date` on results lets birdsI show the user when the doc was written. The credit model is easy to budget.
