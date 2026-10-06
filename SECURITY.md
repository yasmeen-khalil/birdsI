# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private vulnerability reporting on this repository (Security tab, "Report a vulnerability"). You will get an acknowledgement within three working days and a fix or a mitigation plan within thirty.

Include what you found, how to reproduce it, and what it exposes. If you have a fix, a pull request through the private advisory is welcome.

## Scope

- The web app and its `/api/v1` API
- The worker and the scan engine
- The `birdsi` CLI and MCP server
- The GitHub App integration

Out of scope: the third-party services birdsI calls (Nebius Token Factory, Tavily, Supabase, Clerk, GitHub), which have their own programmes.

## How birdsI handles your code

- Repository snapshots fetched from GitHub are deleted when the scan ends. Uploads from the terminal tool live in private storage for up to seven days, so a fix can be applied to the same code, then a scheduled sweep deletes them. Deleting your account deletes them at once.
- The terminal tool never uploads `.env` files, private keys, certificates or credential files, whatever `.gitignore` says.
- Findings, dependency lists, chat messages and usage records are stored per account until you delete them or the account.
- Code excerpts are sent to Anthropic (Claude) or, when the operator chooses it, Nebius Token Factory, for analysis; package names and versions go to Tavily, OSV and deps.dev. They are not used to train models.
- Actions proposed by coding agents are approved in the browser only (never with an API token), may only start with an allowlisted program, and run on your own computer with a minimal environment. Nothing proposed by an agent runs on birdsI's servers.
- Text that birdsI read from a repository or the web is marked as data in everything it hands to an agent, so it cannot pose as an instruction.
- Every database table has row level security enabled with no client policies; all access goes through server code that checks ownership on every query.
- Fixes run in an isolated sandbox before a pull request is opened; the sandbox never has your secrets.
- The GitHub App writes only to branches it creates, and only opens pull requests. It never pushes to your default branch.
