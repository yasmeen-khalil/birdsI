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

- Repository snapshots are downloaded for the duration of a scan and deleted afterwards. CLI uploads live in private storage until the scan finishes.
- Findings, dependency lists, chat messages and usage records are stored per account until you delete them or the account.
- Code excerpts are sent to Nebius Token Factory for analysis and package names to Tavily, OSV and deps.dev. They are not used to train models.
- Every database table has row level security enabled with no client policies; all access goes through server code that checks ownership on every query.
- Fixes run in an isolated sandbox before a pull request is opened; the sandbox never has your secrets.
- The GitHub App writes only to branches it creates, and only opens pull requests. It never pushes to your default branch.
