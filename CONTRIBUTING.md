# Contributing

Thanks for looking. birdsI, the cockpit for your apps, is open source under the MPL 2.0.

## Before you start

Outside contributions are welcome once the contributor license agreement is in place. Until then, please open an issue describing the change first so the work is not wasted.

## Working on the code

```bash
npm install
cp .env.example .env.local
npm run dev        # web app
npm run worker     # background worker
npm run verify     # typecheck, lint, tests, build
```

- Node 22 or newer.
- One `.env.local` at the root serves the web app and the worker.
- Tests live next to the code as `*.test.ts` and run with Vitest.
- The git hooks in `.githooks` are installed on `npm install`. They block secrets and attribution trailers in commits.

## Adding a check

Checks are independent modules in `packages/engine/src/checks/`. Implement the `Check` interface (`id`, `step`, `label`, `available`, `run`) and add it to `registry.ts`. A check returns `FindingDraft`s, and the runner assigns ids, ranks and persists them. Set the confidence class honestly:

- `proven` only when a tool, a rule or a database established it,
- `doc_verified` only when a cited document supports it.

No check reads the code with a model. `judgment` exists only for findings stored before v3.

## Changing the limits list

`packages/shared/src/limits.ts` is checked by a person against each vendor's own pricing page. Change a number only with the page's exact words in `quote`, its address in `url`, and the date in `verifiedOn`.

## Style

- The house rule for anything a person reads (the web app, the terminal tool, MCP tool text, model prompts that shape what people read, and these documents): plain language, no emojis, no em dashes, no semicolons and no exclamation marks. Use commas, colons or periods.
- Buttons are short: a verb and at most a noun or two ("Sign in", "Open pull request", "Audit again").
- Use the product's own nouns. birdsI is the cockpit for your apps. A run over the code is a map. The outside services are vendors. Say repository for code connected through GitHub or uploaded from the terminal.
- The copy guard test (`packages/shared/src/copy/copy.test.ts`) enforces the punctuation on the copy dictionary and on every string literal and JSX text in `apps/` and `packages/`. Code-shaped text (a separator character, shell syntax, Tailwind's `!` modifier) passes.
- TypeScript strict, no `any` unless a third-party type forces it.
- Comments explain why, not what.
- Commit messages are short and technical.
