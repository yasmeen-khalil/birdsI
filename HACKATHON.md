# Hackathon submission notes

**Event:** Nebius x NVIDIA Global AI Hackathon
**Track:** Coding and Agentic Engineering
**Bonus award entered:** Best Use of Tavily (runtime Tavily calls in every scan's docs check)

## Where Nebius and NVIDIA are used

- **Nemotron 3 Nano** (`nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`): light scans, docs comparisons, chat, fix explanations.
- **Nemotron 3 Super** (`nvidia/nemotron-3-super-120b-a12b`): deep scan file reviews, the cross-file contradiction pass, writing fixes.
- **Nemotron 3 Ultra** (`nvidia/Nemotron-3-Ultra-550b-a55b`): the pre-launch audit verdict.
- **Token Factory inference** through the OpenAI-compatible API with JSON schema structured output, fast flavor for interactive work and base flavor for background scans.
- **Token Factory Sandboxes**: every fix is applied to a copy of the repository and the project's own test or typecheck command runs in an isolated VM before a pull request is opened.
- **Token Factory embeddings** (Qwen3-Embedding-8B): code chunks embedded for chat retrieval.

Code: `packages/engine/src/models/client.ts` (inference), `packages/engine/src/fix/sandbox.ts` (Sandboxes), `packages/engine/src/checks/docs.ts` (Tavily).

## Trying it

- Live demo: https://birdsi.vercel.app, press "Scan a sample repo". No sign-in.
- Sign in with GitHub to connect a repository and open real pull requests.
- Terminal: `npx birdsi scan` in any project.
- MCP: `npx birdsi mcp` (configuration snippets in `packages/cli/README.md`).

## Feedback on the tools

Written after the build; kept factual so it is useful to the teams.

**Token Factory**
- The OpenAI-compatible API made integration a matter of a base URL. Structured output with `json_schema` worked as documented; repeating the schema in the prompt, as the docs suggest, noticeably improved compliance on the smaller model.
- The `-fast` suffix for the interactive flavor is a clean design. A per-model capability matrix (JSON mode, tool calling, max output tokens) in one table would have saved trial calls.
- Pricing tables are rendered client-side, so they are not readable by tools that fetch the page; a plain text or JSON version would help builders who script cost estimates.

**Sandboxes**
- The file upload plus `/instances` spawn model is simple and the operation polling with `Retry-After` is considerate. Documentation of the REST API is complete in the OpenAPI spec but the human-readable guides centre on the Python SDK and CLI; a short REST walkthrough (upload, spawn, poll, read stdout) would help non-Python users.
- The list of publicly available image tags is only reachable with a key; publishing it would let builders choose images before signing up.

**Nemotron**
- Nano is fast and reliable for structured tasks with tight prompts. Super produced high-quality code edits with the search-and-replace format. The models responded well to explicit "return an empty list if nothing is wrong" instructions, which matters for an auditor that must not invent problems.

**Tavily**
- Search with `time_range` and a small `max_results` gives exactly the current documents needed for a docs check, and `published_date` on results lets birdsI show the user when the doc was written. The credit model is easy to budget.
