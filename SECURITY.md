# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private vulnerability reporting on this repository (Security tab, "Report a vulnerability"). You will get an acknowledgement within three working days and a fix or a mitigation plan within thirty.

Include what you found, how to reproduce it, and what it exposes. If you have a fix, a pull request through the private advisory is welcome.

## Scope

- The web app and its `/api/v1` API
- The worker and the engine
- The `birdsi` CLI and MCP server
- The GitHub App integration

Out of scope: the third-party services birdsI calls (Supabase, Clerk, GitHub, Anthropic, Tavily, and the vendors whose accounts you connect), which have their own programmes.

## How birdsI handles your code and keys

- Repository snapshots fetched from GitHub live only for the duration of a map. Uploads from the terminal tool are deleted as soon as their map has run, and within a day if the map never starts. Deleting your account deletes them at once.
- The terminal tool never uploads `.env` files, private keys, certificates (`*.pem`, `*.crt`, `*.cer`) or credential files, whatever `.gitignore` says.
- No model reads your code to make the map. The optional docs check sends a few lines around a package's import to Anthropic, with pages of that package's own documentation that Tavily finds from its name. Package names and versions go to OSV and deps.dev, and the npm, PyPI and crates.io registries receive package names. Nothing is used to train models.
- Vendor keys you connect are encrypted at rest (AES-256-GCM under a server-side secret), decrypted only inside the worker while it reads that account (and in the web app once, to check a key before it is stored), and never shown again. Each key belongs to one project and the database refuses any scope but read. Use keys that only read wherever the vendor offers them, such as a Supabase personal access token scoped to the project with Read permissions only. Vercel and OneSignal offer no read-only key, so birdsI only reads with theirs.
- birdsI keeps names, never values. From a Vercel project's env list it copies the name, where it applies and its type, and drops the value. From a OneSignal app it copies counts and the platforms, never the push credentials in the same answer. Every answer is copied field by field into birdsI's own shape.
- The SQL birdsI runs on a Supabase project goes through Supabase's read-only endpoint (as `supabase_read_only_user`) and reads the database's catalog and size only: whether each migration's tables, columns and functions exist. It never reads a row of the app's own tables.
- Log lines (a failed build's errors, a function's errors) are masked for key shapes and cut to 300 characters before they are stored.
- Actions proposed by coding agents are approved in the browser only (never with an API token), may only start with an allowlisted program, and run on your own computer with a minimal environment. Nothing proposed by an agent runs on birdsI's servers.
- Text that birdsI read from a repository or the web is marked as data in everything it hands to an agent, so it cannot pose as an instruction.
- Every database table has row level security enabled with no client policies. All access goes through server code that checks ownership on every query.
- The GitHub App only reads: contents and metadata of the repositories you choose. It never writes.
