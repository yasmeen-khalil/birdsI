# Contributing

Thanks for looking. birdsI is open source under the MPL 2.0.

## Before you start

Outside contributions are welcome once the contributor license agreement is in place; until then, please open an issue describing the change first so the work is not wasted.

## Working on the code

```bash
npm install
cp .env.example .env.local
npm run dev        # web app
npm run worker     # background worker
npm run check      # typecheck, lint, tests, build
```

- Node 22 or newer.
- One `.env.local` at the root serves the web app and the worker.
- Tests live next to the code as `*.test.ts` and run with Vitest.
- The git hooks in `.githooks` are installed on `npm install`. They block secrets and attribution trailers in commits.

## Adding a check

Checks are independent modules in `packages/engine/src/checks/`. Implement the `Check` interface (`id`, `step`, `label`, `tiers`, `available`, `run`) and add it to `registry.ts`. A check returns `FindingDraft`s; the runner assigns ids, ranks and persists them. Set the confidence class honestly:

- `proven` only when a tool or rule established it,
- `doc_verified` only when a cited document supports it,
- `judgment` for anything the model read into the code.

## Style

- Plain language in every user-facing string. No emojis. No em dashes in UI copy (the copy guard test enforces this).
- TypeScript strict, no `any` unless a third-party type forces it.
- Comments explain why, not what.
- Commit messages are short and technical.
