# Hackathon submission notes

## Nebius x NVIDIA Global AI Hackathon, October 2026

**Track:** Best Apps and Agents. **Bonus track:** Best Use of Tavily. Solo entry by the owner, built with AI coding tools.

**What birdsI is.** The cockpit for your apps. Point it at an app's repository and it maps the code (every service, dependency, env name, cron, webhook, store app, migration and public page, with file and line), reads the accounts behind the app with keys that only read, and keeps one stream of alerts for what needs you. The map is built by rules first, then the model reads the code for what the rules missed, and a verifier opens the file and confirms every find at its line before it reaches the cockpit. Nothing a model says reaches you unverified.

**Where Nemotron on Nebius Token Factory is used.** All model calls go through one door, `packages/engine/src/models/client.ts`, which calls Token Factory's OpenAI-compatible chat completions API (`https://api.tokenfactory.nebius.com/v1/chat/completions`) with `response_format` set to a JSON schema (falling back to `json_object` when a model declines a schema), retries on 429 and 5xx with the server's `retry-after`, and records every call's tokens and cost in a usage ledger. Two sizes sit behind it, picked by the task:

- **Nemotron 3 Nano** (`nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`): the reading of the code after the rules (`packages/engine/src/reader/index.ts`, in segments of the files that changed since the last map, each find with a file, a line and a quote); what each service is used for (`reader/schema.ts`, the purposes); the docs check (`packages/engine/src/checks/docs.ts`, a main package's own current documentation against how the code imports it); a failed deployment explained in plain words from the error lines the host kept (`packages/engine/src/cockpit/explain.ts`).
- **Nemotron 3 Super** (`nvidia/nemotron-3-super-120b-a12b`): what a vendor's pricing page states now when a quoted sentence the checked limits list rests on has gone from it (`packages/engine/src/limits/watch.ts`).

The key you set picks the provider (`NEBIUS_API_KEY`), and `BIRDSI_MODEL_NANO` and `BIRDSI_MODEL_SUPER` override the ids. Token Factory's implicit prefix caching keeps the repeated system prompt and map summary cheap across the segments of one map. The same door takes Claude through Anthropic when only that key is set, so the product does not depend on one vendor, but the submission runs on Nemotron.

**Where Tavily is used.** The docs check finds each package's current documentation pages with Tavily search and reads them with Tavily extract before the model compares them with the code. The weekly watch fetches every pricing page the checked limits list rests on through Tavily extract, and code, not a model, decides whether each quoted sentence is still on its page.

**What the judges can try.**

- The demo page, DEMO_URL/demo: the cockpit of the sample app in `samples/corner-bakery`, readable without signing in. It shows what the rules found, what the model added (marked as the model's, confirmed at file and line), the accounts behind it, the security section with its honest scope statement, the money section, and the open alerts: a webhook that never checks its sender, a cron that skips its secret, env names declared and never read, a package never imported, and whatever the connected accounts say that day.
- Sign in with GitHub and add an app of your own: run `npx birdsi` in its folder (from a clone of this repository: `npm install`, then `npx tsx packages/cli/src/birdsi.ts`), and the Set up page lists what to connect and what each key lets birdsI read before you make one.
- `npx birdsi cockpit` in the terminal, or `npx birdsi mcp` inside a coding agent, gives the same view.

The deployment stays up for the judges through 15 December 2026.

**Setup** is in README.md (Setup): a Supabase project with the migrations run, Clerk for sign-in, and `NEBIUS_API_KEY` and `TAVILY_API_KEY` in the environment. The worker runs on any Node host.

**Honest scope.** The rules read the code and prove what they find. The model's finds are confirmed at their line or dropped. No model judges the code's own logic in this version, and the security section says so on the page. The reads of the accounts are what the vendors' APIs report, dated, and a part birdsI could not read says why and is never shown as zero.

**Feedback for Nebius (Token Factory).** Written while building, in the spirit of the feedback prize:

- The structured output guide documents `response_format` with `json_schema`, and the OpenAPI specification lists only `json_object` and `text`. birdsI sends the schema and falls back to `json_object` on a 400 that names the format, which works, but one source of truth would save every builder a retry path.
- Model ids differ in casing between models (`nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` and `nvidia/nemotron-3-super-120b-a12b`). A single convention, or aliases, would spare copy mistakes in environment files.
- Implicit prefix caching is excellent for a tool that sends the same system prompt and map summary many times per run. Exposing the cached share in the usage object (it is there as `prompt_tokens_details.cached_tokens`) deserves a line on the pricing page, because it changes what a builder designs.
- The model catalog as Markdown (`tokenfactory.nebius.com/model-catalog.md`) is the most agent-friendly catalog of any provider birdsI reads. More of the docs in that form would help.
- A per-key dashboard of requests per minute against the dynamic rate limit would make the 429 budget visible before the first retry.

## Supabase Select Hackathon at YC, 3 October 2026

Submitted, not demoed, as the operations layer for coding agents: a vendor inventory, connectors, questions and approvals, MCP tools, with Claude behind the model door. Since v3 (18 October 2026) birdsI is the cockpit for its owner's apps, and the code audit of that version is gone. The development record up to v3 is kept at `birdsI-beta`, and this repository continues from it.
