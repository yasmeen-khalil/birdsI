# Changelog

## v4 (unreleased): the reader with a model

A model reads the code again, behind a verifier: rules first with the file and line, then Nemotron on Nebius Token Factory or Claude, and nothing a model says reaches a page unverified. Built in steps, each with the full chain green.

### Step 1: the model door

- Two providers behind one door: Nemotron on Nebius Token Factory (`NEBIUS_API_KEY`) and Claude through Anthropic (`ANTHROPIC_API_KEY`). The key that is set picks the provider, Nemotron first when both are, and `BIRDSI_PROVIDER` forces one. Two sizes per provider: a small model (Nemotron 3 Nano or Claude Haiku 4.5) for reading and the docs check, and a large one (Nemotron 3 Super or Claude Opus 5.5) for verification, with `BIRDSI_MODEL_NANO` and `BIRDSI_MODEL_SUPER` to override the ids. `BIRDSI_MODEL_DOCS` is gone.
- Token Factory calls use its JSON schema output, answer in plain JSON mode for a model that refuses the schema, retry on rate limits, server errors and lost connections with the provider's retry-after, and price cached prompt tokens at the cached price.
- The docs check runs on whichever provider is set, with Tavily. Without a model key the map runs without it and says so.
- Reasoning a model wraps in think tags is dropped before an answer is parsed, and an answer cut off at the output limit is asked again shorter.

### Step 2: the reader

- After the rules build the map, the small model reads the code and names what the map lacks: a service, an env name read through a helper, a cron in a GitHub Actions workflow or pg_cron, a webhook outside the usual folders, a store app config, a migration source, a second deployable. Every find comes with its file, line and the line's text, and a verifier opens the file and confirms it before the find joins the map. A find whose line does not say what the model claimed is dropped and counted. Services, env names, crons, webhooks and store apps join their part of the map marked found by the model, with the confirmed line. Other kinds are listed on the cockpit as also found.
- A find that names a catalog vendor gets the catalog's links and category. A service the catalog does not know gets a slug, the model's category and no links yet.
- What the app uses each service for, in one sentence, read by the model from the call sites and shown as Judgment on the service, the Vendors page and the terminal.
- The code goes to the model in passes of about 50,000 tokens with the map so far as the cached prefix, every line numbered, key shapes masked, tests, docs and data left out. Files over 2 MB and minified text are never read (the map's own rules now read files up to 2 MB too, so a 400 KB server file is no longer skipped). A reading budget per map (`BIRDSI_READ_BUDGET_TOKENS`, four million tokens) and the daily spend caps stop the reading, never the map. `BIRDSI_READER=off` turns the reading off, `BIRDSI_READ_CONCURRENCY` sets the passes in flight.
- Every readable file is hashed into the map. The next map reads only the files that changed, and carries the previous finds of unchanged files over after confirming them again on today's files. `npx birdsi` on an unchanged app makes no model call.
- The run shows the reading as its own step with the passes done, and ends with one line: files read, finds confirmed, dropped, carried, already on the map, left for the next map.
- `scripts/map-app.mts` reads with the model too when a key is in `.env.local`, uses an existing output file as the previous map, and takes `--no-model`.

### Step 3: the gap rules and the scope statement

- A new Proven check reads the map against itself: a Vercel cron with no handler file, a cron handler that never reads `CRON_SECRET`, a webhook route with no line that checks the sender, an SDK in use with no key named in the code or the example env file, an env name declared in the example file that nothing reads and no SDK could read, packages listed in dependencies that nothing imports (tooling left out), files under the app's source folders that no page, route or entry reaches, and two services for one job (email, payments, sign-in, analytics, error tracking). Each finding carries the file and line it rests on and what resolves it. The two cockpit warnings that were red text only, a cron without the secret check and a webhook without a sender check, are findings now, so the terminal, the MCP tools and the findings page carry them.
- Two new categories: redundancy and stale.
- Every map ends with a scope statement in its summary: what was checked, with each check's reach in one sentence, what was not checked and why (a key not set, the reading turned off, and always that no model judges the code's own logic in this version), and which model took part. The findings page shows it, `birdsi findings` prints it, and the MCP scan summary carries it.
- The editable prompt per section moves to step 5, with the sections themselves.

### Step 4: the checklist

- A Set up page per app, first in the nav after the cockpit, built from the map: the map itself, the model's reading, the app record, each service birdsI can read with two steps (declare the project, connect a read key) and for each the exact clicks to make the key, what birdsI will read once it is connected and what it will alert on, the vendors it cannot read yet with links only, email alerts, the dates no API reports, and the coding agent. Each step says done, to do, not working (a key that stopped working, with the vendor's words), waiting (a migration) or optional, and where to do it. The page says once what birdsI may do with what you connect: read only in this phase, nothing changed at a vendor, writes later behind your approval.
- The cockpit shows a strip with the required steps done and the next one until the checklist is complete.
- `npx birdsi setup` prints the same list, `GET /api/v1/repos/:id/setup` returns it, and agents read it with the `birdsi_setup` MCP tool. The steps are the owner's: keys are pasted in the browser, never through an agent.

### Step 5: the cockpit's sections, the prompts, the icons

- The cockpit page is organized into the owner's sections, in this order: what needs you (the alerts), the services and dependencies by what each is for (hosting, database, sign-in, payments, email, messaging, AI, analytics, monitoring and the rest) with each service's logo, its purpose as the model read it, its documentation and whether the docs check read it and when, its plan and the key that reads it, then a line on the packages (how many, how many direct, with known problems, two or more majors behind, checked against their docs, and the devtools), the live reads (deployments, database, push), the last map (when, which commit, how many files, packages and routes, what the model read, what was checked and what was not), security (every open finding by severity and by category with the worst severity, the five to start with, and what was not checked), money (spend read from the accounts this month and a year at that rate, the list prices of the plans the accounts are on from the checked limits list, kept apart as not money spent, and usage against limits), then the code's crons, webhooks, store apps, migrations and public pages, the vision and the recent maps. The findings summary that used to sit under The code is the Security section now.
- The app's own icon shows in the header, fetched from its live address (the production deployment or the store app's site), and each service shows its logo, from Simple Icons' address, or a letter tile when there is none. `NEXT_PUBLIC_BIRDSI_LOGOS=off` keeps every list to letter tiles.
- Prompts per section, on the Agent page: for the model's reading of the code, the purposes, the docs check and the security pass, birdsI's default is shown and stays, and what you add for this app is used by the next map and kept in the record (kind `prompt`, the newest per section). The security pass is not on in this version, and its prompt says so.
- `birdsi cockpit` and the `birdsi_cockpit` MCP tool carry the security and money summaries. `GET /api/v1/repos/:id/cockpit` returns the new sections.

### Step 6: what no API reports, and the cost of running

- A quiet section on the Projects page, What no API reports: a subscription paid elsewhere, a yearly fee, a credit that runs out, a note, each with an amount and how often, a renewal or end date, a vendor and a note. Migration `20261027000000_manual_entries.sql`, table `app_entries`, with its marker in `verify.sql`.
- The money section now says the cost of running as far as it is known: about so much a month and so much a year, from spend read from the accounts that report it, the plan's list price where none does (counted until the account's spend can be read, then shown as not counted), and what you entered, marked by you and kept apart. A yearly amount is spread over twelve months. A credit, a note or a one-time amount is listed and never counted.
- A renewal date you entered joins the alerts like a date to watch, from 30 days before.
- The Set up page has an optional step for it, and the terminal's cockpit says the cost in one line with its three parts.

### Step 7: a failed deployment in plain words, and the watch over the pricing pages

- When the newest production deployment of a Vercel project failed, the small model reads the error lines Vercel kept (never the code) and says in two or three plain sentences what broke and what to look at. The explanation sits on the failed-deployment alert, on the Vercel card and in the terminal, marked as the model's reading. It is made once per failure: while the alert stays open the same words are reused.
- Once a week, when Tavily is set up on birdsI, the worker reads every pricing page the checked limits list rests on (migration `20261027000100_limits_watch.sql`, table `limits_watch`). Code checks that every quoted sentence is still on its page. When one is gone, the large model says what the page states now, as a proposal for a person. The list itself is never changed by a machine. The next read of every app that uses that vendor opens a notice, Pricing page changed, with the sentences gone and the proposal. It closes by itself when the page matches the list again, so updating the list closes it. A page that could not be read, or came back nearly empty, changes nothing until it is read.
- The daily spend caps now gate every model call (the reading, the purposes, the docs check, the explanation, the watch), and say so.

### Step 8: four more accounts read

- Clerk: with the instance's secret key, whether the key belongs to the declared instance, the instance's environment, and the users and organizations as Clerk counts them. Never a user's data. The plan and monthly retained users are not in Clerk's API, and the card says so.
- RevenueCat: with a v2 secret key, the project's name and apps and the overview metrics in US dollars (active subscriptions and trials, monthly recurring revenue, the revenue, new customers and active users of the last 28 days). The revenue counts against the free plan's monthly tracked revenue in the checked limits list, so the usual 80 and 95 percent alerts apply. A part the key may not read names the permission it needs instead of failing the key.
- App Store Connect: with an API key's .p8 file (the Key ID and Issuer ID are asked for when the key is connected), the app and its bundle id, the version live on the App Store, the version in progress and where it stands with App Review, a rejected version, and the newest build and whether it processed. Sales and the membership's renewal are not read.
- GitHub: with a fine-grained token for the repository, its visibility, default branch, last push and open issues, the newest workflow run on the default branch, the open Dependabot, secret scanning and code scanning alerts by severity, and the account's usage this month (Actions minutes against the plan, and the bill so far).
- New alerts from those reads: a failed workflow run on the default branch, an open secret scanning alert (critical), an open Dependabot or code scanning alert of critical or high severity, a version App Review rejected, a build that did not process. Each closes when a later read no longer finds it, and a read that fails leaves it as it was.
- A vendor you declare a project for on the Projects page gets a row in the map even when the code never names it (an App Store record, say), marked as found through the Projects page, so its account is read like any other.

### Step 9: the code's webhooks against Stripe

- The Stripe key (now with Webhook Endpoints: Read) also reads the endpoints registered at Stripe: each shows on the Vendors page with its state and events.
- Every hour the cockpit compares them with the Stripe webhook routes in the map, on the app's hosts as the Vercel reads know them. A route no enabled endpoint points at opens a warning (Stripe sends it nothing), and so does an enabled endpoint pointing at the app with no route behind it (every delivery fails). A disabled endpoint is said to be disabled. Without a host, paths alone are compared, and an endpoint birdsI cannot place is never flagged. A read that fails leaves the alerts as they were.

### Step 10: the demo page, the sample app and the submission

- A public demo page, `/demo`, shows the cockpit of the app named in `BIRDSI_DEMO_REPO_ID`, as its owner sees it, to anyone, without a key or a control on it. Without the variable it says no sample app is set up.
- `samples/corner-bakery` is back: a bakery's online ordering app with problems left in on purpose (a webhook that never checks its sender, a cron that skips its secret, env names declared and never read, a package never imported, a secret written in the code as a fallback) and a `verify.sql` with markers, so the demo shows every kind of find and alert.
- README and HACKATHON.md say where Nemotron on Token Factory and Tavily are called, file by file, what the judges can try, and the honest scope.

## v3 (2026-10-18, unreleased): the cockpit

birdsI becomes the cockpit for its owner's apps: one page per app, read from the code and from the vendors' own APIs, and what needs the owner. Built in checkpoints, each with the full chain green.

### Step 7: the documents and the owner's clicks

- The setup steps for v3 in one place: the seven migrations in order and `verify.sql`, the keys v3 no longer reads, a key per vendor with the exact clicks (a Vercel token scoped to the team, a Supabase personal access token scoped to the project with Read permissions only, a OneSignal App API key) and where each goes, the alert email key, the dates to watch.
- The security policy says what the alert email holds and what the MCP tools may do. The feature map, the architecture and the security notes describe the cockpit end to end.

### Step 6: the cockpit

- Each app's page is its cockpit now (the nav's first item, Cockpit). From the top: the open alerts with what to do, then each Vercel project (the deployment its label names, the newest production deployment with its state, age, commit and error and what production still serves, the env names the deployment's code needs against the ones set per environment with the missing ones named, its crons registered or not, its domains, the error lines read, its key's expiry), each Supabase project (running or paused, the size against the plan's limit, the migrations owed, the security and performance advisors), each OneSignal app (subscriptions, the platforms, OneSignal's estimate of a send to everyone and whether mobile push is dropped, recent messages with their counts), then what the map read from the code (services with their plan and key state, crons with their handler and whether it checks the secret, webhooks with the line that checks the sender, store apps, migrations, public pages). The code's findings, the vision and the recent maps follow under The code.
- Every part says where it came from, and a part birdsI could not read says why. A project with no key, no read yet or a migration still to run says so on its card.
- Nothing on it is written per app: Lamp Post's cockpit renders from its map alone, and names the vendors whose projects are still to declare.
- The same view for agents and the terminal: `birdsi cockpit` and `birdsi alerts` (both with `--json`), the `birdsi_cockpit` and `birdsi_alerts` MCP tools (read only, with the data marked as data), and `GET /api/v1/repos/:id/cockpit`. The MCP section of the terminal tool's README says what every tool may do.
- `scripts/cockpit-from-map.mts` renders a cockpit in the terminal from a stored map, for checking an app before any key is connected.

### Step 5: the alert stream

- Alerts are stored now, one row per cause (`20261018000400_alerts.sql`). Every read of an app (hourly, and after every map) checks it from its service map, its project reads, its account facts and its dates to watch: a new cause opens an alert, a cause still there refreshes it, and a cause a read checked and no longer found closes it. A cause a read could not check (a paused database, a key refused) is left as it was, never closed on no evidence.
- The kinds: a paused Supabase project, a failed newest production deployment, a cron from `vercel.json` that the Vercel project has not registered or has switched off, an env name a deployment's code reads without a default that its Vercel project does not set (per environment the app checks, the deployment chosen by the project's label), a migration the database still owes, a plan limit (usage at 80 or 95 percent of the checked limit, a cron more frequent than the Vercel plan allows, mobile push dropped by OneSignal for the plan), a date (a Vercel key's expiry, or a date to watch), and a project no part of which could be read.
- Every alert is one sentence with the object, who or what acted on it, the rule with its numbers, and the result, plus what to do and where the evidence is (the vendor's page, the file and line). For example: "The cron /api/cron/digest runs 96 times a day (every 15 minutes, vercel.json:5), and Vercel's Hobby plan allows 1 run a day" with the page's own words.
- The Alerts page on each app: open alerts first, newest first, with closed ones for two weeks, filtered by open, closed or all and by kind. `GET /api/v1/repos/:id/alerts`.
- Dates to watch on the Projects page: a trial that ends, a credit that runs out. The alerts warn from 30 days before.
- New alerts are emailed through Resend, one email per read, when `RESEND_API_KEY` is set on birdsI and email alerts are on in Settings. Each alert says whether it was emailed or why not (no key, no address, email off, or Resend's own answer), and Settings and the Alerts page say whether email is on.
- The privacy page names Resend and what alerts keep.

### Step 4: three read connectors

- Each Vercel project, Supabase project and OneSignal app of an app is read in depth with its own key, every hour and after every map, and each read is kept (`20261018000300_project_reads.sql`, the newest 48 per project). `GET /api/v1/repos/:id/reads` returns the newest read of each project.
- A read has parts, and each part is dated with the API address it came from and the dashboard page that shows the same thing. A part that could not be read carries the reason in plain words (the key refused, the project not found, the vendor slowing birdsI down, the project paused) and is never a zero. One part failing never hides the others.
- Vercel: the project and its production address, the last 20 deployments with state, target, age, commit and error message, every env name with the environments it applies to and its type (never its value), the crons Vercel has registered and whether they are on, the domains and whether each is verified, and the error lines of the last failed build and of the live deployment's functions, masked.
- Supabase: the project's status (paused or not), the database size, the security and performance advisors, and the migrations owed, from the markers in the app's `verify.sql` (read by the map) checked against the database's catalog through Supabase's read-only endpoint, or from the project's migration history for Supabase CLI migrations. The SQL reads the catalog and the size only, never a row of the app's tables.
- OneSignal (new): the subscriptions and how many can receive a message, the platforms the app sends to, what a send to everyone would reach and whether OneSignal is dropping mobile push for the organization's plan (its estimate, which sends nothing), and the last 10 messages with OneSignal's own counts per platform. A campaign keeps its name. A message sent to one person keeps no text. Connecting a OneSignal key works now: before, the Projects page offered it and refused it.
- Keys scoped to one project work. A Vercel token scoped to the project is accepted, and the plan says it needs a team token to be read. A Supabase token scoped to the project reads the project, the plan when it may read the organization, and the size.
- The Supabase connector no longer counts rows of the app's own tables (its users for active users, its files for storage): an app's own data is read only through the app's ops API or exports (the owner's rule). Its hard-coded plan allowances are gone too: the checked limits list is the one source.
- A key's state on the Projects page follows the deep read: it says the key could not read only when no part of the project could be read.
- The privacy page and the security policy say exactly what is read and kept.

### Step 3: the service map

- Every map now reads the app's service map, by rules, with the file and line of every entry. No model reads the code.
- Services: each one found, with its SDK imports (the first twelve places), its env names, its dashboard and pricing page, and whether the checked limits list covers it.
- Env names: every name the code reads (`process.env`, `import.meta.env`, `Deno.env.get`, destructuring) or the example env file declares, the deployment that reaches it, whether it is public, optional and why (the example file says so, or every read has a default), its alternatives (`SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY`), and the first eight places it is read. Names a vendor's SDK reads are tied to where the SDK is imported. Platform names (`NODE_ENV`, `VERCEL_*`) are left out.
- Deployments: one codebase serving several (Flowsophy's product, ops and schools) is read from the code's own comparisons, such as `process.env.APP_ROLE === "ops"`, and each route belongs to the role its path names, to the crons, to the webhooks or to the shared product. What each deployment needs follows: the product needs every name its routes reach and never the role name, another deployment needs its own routes' names and the role name, and shared code's names are listed apart.
- Crons from every `vercel.json`: the schedule in words, times a day, the handler file and whether the handler (or a helper it imports) checks `CRON_SECRET`.
- Webhooks: every route with a `webhook` or `webhooks` folder in its path, with the sender, the methods, and the line that checks the signature or the shared secret.
- Store apps from Capacitor, Xcode, Gradle, Expo and app config: bundle id, name, web address, merged across files.
- Migrations: Supabase CLI, numbered (`0001_`) or versioned (`supabase-vN.sql`) files, the `verify.sql` markers, and a `schema_migrations` record when the code creates one. Which ran where is read from the database in step 4.
- The public pages: sitemap, robots and `llms.txt`.
- The map names env variables and never holds a value: only example env files are read, for names and comments, and every source line is masked.
- Each map is kept, dated, with its commit and branch, the newest 30 per app (`20261018000200_service_maps.sql`). `GET /api/v1/repos/:id/map` returns the newest with the dates of the ones before.
- The live map and the terminal show the map's totals. The Projects page names the deployments the code serves and checks a Vercel project labelled with one against that deployment's needs.
- `scripts/map-app.mts` maps an app on this computer (its last commit) and writes the map as JSON. Flowsophy, Lamp Post and Vaultaire were mapped with it on 2026-10-18.
- Two services joined the catalog: MetalpriceAPI (metal prices) and App Store Connect (any app with an Xcode project).

### Step 2: apps, and keys tied to projects

- An app is its own record: a name, the repository its code lives in, the environments birdsI checks (production by default), and the vendor projects it has. Every repository is an app from its first map on.
- A project is one place at a vendor: a Vercel project per deployment (the product and the ops one), a Vercel team, a Supabase project ref or organization, a Clerk instance, a OneSignal app id, a RevenueCat project, a Stripe account, an App Store app id, a Resend domain, an Anthropic organization. Each id is checked against the shape that vendor's ids have, and each project links to its own place in the vendor's dashboard.
- A key belongs to one project of one app, never to a vendor per person. It is checked with the vendor before it is stored, stored encrypted, never shown again, and only reads: the database refuses any other scope. Two projects can share one key without the key ever leaving the server ("Use the key of"), and the page says which projects share a key by a keyed fingerprint, never by the key.
- The new Projects page on each app: name, environments, projects grouped by vendor, each key's state and the reason when it could not be read, and the record of every change (a new record kind, Projects and keys).
- Keys connected before v3 move without loss (`20261018000100_apps_projects.sql`): for an owner with one app each becomes a project of it. With several apps they stay as they were, are still read the old way, and the Projects page ties each to its project in one step.
- The read job reads each project with its own key, and a vendor with several projects (Flowsophy's three Vercel projects) gets each project's facts under its label.
- Agents see the app's projects and each key's state in `birdsi_inventory`, `birdsi inventory` and `.birdsi/projects.md`.
- Every migration now runs in the tests, in order, on a real Postgres (PGlite), and `verify.sql` must say OK on every row.

### Step 1: the cut

Removed, with their routes, screens, strings, tests and dependencies:
- The model-driven code audit: the model review (Judgment findings), the cross-file pass, the Pre-launch audit and its page, fixes and pull requests, sandbox testing, chat and its code index. `birdsi fix`, `birdsi ask`, `birdsi_fix` and `birdsi_ask` are gone, and so are `--full`, `--deep`, `--audit`, `--describe` and the fix prompts.
- The hackathon scaffolding: the Nemotron provider, Token Factory embeddings and Sandboxes, LangSmith tracing, the sample bakery app and its no-sign-in demo. `openai` and `langsmith` left the dependencies.
- Plan tiers read from pricing pages by a model every week, and the questions that asked the owner to type a plan or a dashboard number.
- Nothing was dropped from the database: `20261018000000_v3_retire_audit.sql` marks the retired tables (chat messages, code passages, fixes, the pricing cache) and keeps every row.

What replaced them:
- One kind of run: a map of the code. `npx birdsi` and `birdsi map` (also `birdsi scan`) map the app in about a minute. No model reads the code. The rule-based checks stay (committed keys, unsafe settings, OSV vulnerabilities, packages far behind), and the docs check stays, optional, on Claude only, citing the package's own documentation.
- A checked limits list (`packages/shared/src/limits.ts`): sixteen vendors, each plan's limits, what ends it and the next price, read on 18 October 2026 from each vendor's own page, every number with the page's exact words. Two records it corrected: OneSignal's free plan sends mobile push only under 1,000 monthly active users since 1 October 2026, and Resend's free plan allows 3 domains.
- The read job writes the plan's checked limits as facts citing the page and the date, and alerts compare usage with them.
- `supabase/verify.sql`: one read-only query that says which of birdsI's own migrations have run.

Fixed:
- Uploaded code was kept seven days for fixes that no longer exist. It is now deleted as soon as its map has run, and within a day if the map never starts.
- Monthly spend no longer adds a plan's list price to money read from accounts.
- The Vercel connector no longer calls a personal account Hobby without reading it.
- Stripe revenue reads every page of the month's charges (up to 1,000) and takes refunds off, instead of the first 100 with refunds counted.
- The landing page and footer linked to a private repository and an unpublished package. The links are gone, and the privacy page and terms point to the operator on GitHub.
- `changes` leaves the removed model review's findings out, so they never show as resolved after the cut.
- The privacy page, terms and security policy describe what v3 does.

## v2 (2026-10-03, unreleased)

The operations record for an app, built for coding agents.

### Since the submission (from 2026-10-04)

Trust, before any user beyond the owner:
- The terminal tool never uploads `.env` files, private keys, certificates or credential files, whatever `.gitignore` says.
- Uploaded snapshots are kept seven days, then deleted by an hourly sweep, and deleted at once with the account. The privacy page and SECURITY.md say exactly that.
- Approvals are decided in the browser only. A bearer token (the one an agent holds) is refused.
- `approvals run` only runs allowlisted programs (stripe, npm, npx, pnpm, yarn, bun, vercel, supabase, railway, fly, flyctl, gh, git, node), with a minimal environment, each after a yes.
- Text read from the repository or the web is marked between « and » in every agent-facing result.
- A per-user daily spend cap (default $5) beside the global one (default $50). The no-sign-in demo replays a finished run from the last six hours instead of starting a new one.
- gitleaks in CI, and `sk-ant-`, `bsi_` and `rk_` shapes in the pre-commit hook.

Cheaper and faster scans:
- The repository digest and context notes are cached by the provider across a scan's calls (prompt caching).
- Files unchanged since the last finished scan keep that scan's findings instead of being read again, in every tier. The review emits an index of file hashes for the next scan.
- Vendors are stored the moment they are found, so the inventory is visible within the first half minute of a scan.
- The bare `birdsi` is the Quick check and `--full` the Full scan (since 2026-10-05). Every time claim matches the measured runs.

Usage made real:
- Supabase: database size, file storage and monthly active users read with read-only SQL through the Management API, against the plan's allowances.
- Anthropic: cost and usage reports read in full (paginated), cached tokens counted.
- Usage the owner typed expires after thirty days and is asked again.
- A daily vendor sync at 06:00 UTC (`/api/cron/sync`, behind `CRON_SECRET`) for every repository whose vendors were synced more than twenty hours ago. Replaced on 2026-10-06 by the worker's own schedule, below.

Built for agents:
- `birdsi inventory` and `birdsi changes`, both with `--json`. The read commands take `--json`.
- MCP: `birdsi_changes_since` (new and resolved findings by stable key). `birdsi_inventory`, `birdsi_vendor` and `birdsi_changes_since` return structured content as well as text. `birdsi_scan` returns after four minutes if the scan is still running.
- `GET /api/v1/repos/:id/changes?since=<scanId>`.
- A skill, `skills/birdsi/SKILL.md`, that tells an agent when to read birdsI and how to read its facts.
- `birdsi mcp --install-hint` pins the version and puts no token in any file.
- The docs check only reads the package's own documentation: domains from the registry record (npm, PyPI, crates.io, and the repository for Go), GitHub only for the package's repository and advisories. A package without a known official source is reported as unknown, not checked against a blog post.

Faster, and the worker keeps its own clock (2026-10-06):
- The review and the docs check run several model calls at once (4 on quick checks, 3 on full scans, `BIRDSI_SCAN_CONCURRENCY`). The budget is checked before every call.
- The worker schedules vendor syncs itself: hourly for owners with a connected account, daily for everyone. No outside cron and no secret to set. `/api/cron/sync` stays as a manual trigger.
- A priority lane: quick checks, demo scans and fixes are claimed before full scans and syncs (migration `20261006000000_queue_priority_workers.sql`).
- Worker presence: each worker reports in every half minute, and a queued scan says plainly when no scanner has reported in for two minutes instead of "starts in a moment".
- Code deployed before a migration runs keeps working: new columns and tables are probed and used once they exist.
- The terminal tool says when a feature waits on a database migration the operator has not run, instead of a generic server error.

The record (2026-10-06):
- Every change outside the code now has an author and a reason, in one append-only record per app: decisions, facts stated, findings marked fixed, dismissed or reopened, fixes started, the vision, the policy, questions answered or dismissed, commands approved or denied, and what happened when they ran.
- Agents write to it within the owner's policy (a toggle on the Agent page, on by default): `birdsi_record_decision`, `birdsi_record_fact`, `birdsi_mark_fixed`. A fact an agent states carries the source "Your coding agent told birdsI" and is outranked by the connected account and by the owner. A fixed mark is judged by the next scan.
- Reads: `birdsi_record` and `npx birdsi record --json`. The inventory carries the latest twenty decisions so an agent never asks what was already decided. The owner writes with `npx birdsi decide` and `npx birdsi fixed`, and reads the record on the Agent page.
- `GET` and `POST /api/v1/repos/:id/record`, `POST /api/v1/findings/:id/fixed`. Migration `20261006000100_record.sql`.

Policy as a rule at the shell (2026-10-06):
- `birdsi policy` shows the repository's agent policy, and `birdsi policy check` is a Claude Code PreToolUse hook (`birdsi policy --hint` prints the snippet). A command that changes a vendor account (Stripe, Vercel, Supabase, Railway, Fly.io, GitHub secrets, variables, releases and repository deletes, npm publish and package ownership) is stopped with the reason and the agent is told to propose it through birdsI. Reads, status, logs and local work pass without a network call. `GET /api/v1/repos/:id/policy`.

Measured and corrected (2026-10-06):
- A repeat quick check of a 546-file repository takes 21 seconds and costs $0.04. The first after a change reads every changed file (311 seconds and $0.70 for 40 files on the first run). The scan stats now carry `cachedTokens`.
- Cached input was priced as uncached. Reads now cost a tenth and cache writes a quarter more, in the ledger, the spend caps and the stats.
- The review reports at most four findings per file, short and exact, which halves the output half of each call and removes most repair calls.

Security round (2026-10-13):
- Spending limits hold while work runs. The worker checks the daily cap for everyone and for each person at the start of every job and before every model call, so a scan stops when the limit is reached instead of running past it.
- A fix can only read and change files inside the code it was written for. A path that points outside it is refused.
- A GitHub installation belongs to the account that connected it first. The install link is signed for the person who started it, and an installation id in a link can never move repositories to someone else.
- Each scan keeps at most 60 vendors, and at most 10 that are not in the catalog, since each one can cost web searches and a model call.
- The job queue is fenced: a worker that lost a job writes nothing about it, and a job that keeps stopping its worker is failed instead of retried forever.
- Environment files and credential files never leave the computer, even when a `.gitignore` tries to bring them back. The MCP server only uploads the folder it was started in, or the git repository around it.
- Anything shaped like a known key is masked before it is stored or shown: vendor call sites, code excerpts and chat passages. A private key block is removed whole.
- Text read from a repository or the web is marked between « and » in every result an agent reads.
- Deleting an account removes everything it owns and keeps only an empty, marked-deleted shell, so the spending already counted today still counts if the same person signs in again.

Wording and the Demo tag (2026-10-13):
- The word Demo sits at the top right of every page while birdsI is a demo, on phones too, including the legal pages, sign-in, connect and the 404 page.
- One voice everywhere: no emojis, em dashes, semicolons or exclamation marks, short buttons, and the product's own nouns. The copy guard test catches semicolons and exclamation marks as well as em dashes.
- Every screen and document says what the code does today: scans read up to 400 files and audits up to 600, the vision is read by agents and by chat, and a fix is tested in a sandbox only when sandbox testing is set up, otherwise the pull request says so.
- A scan from the terminal offers to apply each fix to your files and no longer asks about a pull request it cannot open.

### The 2026-10-03 release

- Vendors: every outside service found from packages, env names, URL domains, config files and Stripe Projects state. Unknown services are named from their env var, and what each is used for comes from the call sites.
- Connectors for Vercel, Supabase, Stripe, Anthropic, Tavily, Supadata and Resend: plan, usage, limits, spend, read with a token the owner connects once (tested before saving, encrypted at rest).
- Vendor knowledge: what a service is and its plan tiers, read from its current pricing page and cached for a week. The plan's limits become facts with the source cited.
- Alerts at 80% and 95% of any limit, computed at read time, with the Stripe Projects command that fixes it.
- Questions: what birdsI cannot know is asked once, in one queue, and answers become facts. Agents ask there too.
- Approvals: agents propose plain commands, the owner approves, and the terminal tool runs them on the owner's machine and reports back. A per-repository policy with an optional auto-approve threshold.
- Vision: the owner's words, read by agents and by chat.
- A pipeline in dependency order with freshness per stage, and one Full scan button. `birdsi` with no command ran it and opened the dashboard (the Quick check since 2026-10-05).
- Claude (Haiku 4.5, Opus 5.5, Fable 5.1) behind the same model door as Nemotron, selected by key. Embeddings come from Token Factory when its key is present, and chat searches by keywords otherwise.
- Local repositories: snapshots from the terminal belong to a repository, so the dashboard, chat, vendors and questions work without the GitHub App.
- CLI: `vendors`, `questions`, `approvals`, `vision`, `export`. MCP: `birdsi_inventory`, `birdsi_vendor`, `birdsi_vision`, `birdsi_questions`, `birdsi_ask_owner`, `birdsi_request_action`, `birdsi_action_status`, `birdsi_sync_vendors`.
- Web: Vendors and Agent pages, the pipeline strip, alerts, vision editor, connected accounts in Settings.
- Trackers for what might happen (a free plan that pauses, a trial that ends), runway for usage that grows toward a limit, and a ninth audit area, Services and limits, judged by rule from the alerts.
- The light theme, with Newsreader, Geist and Geist Mono type.
- Chat helps with the product and the project, not only the code, and the connect page leads with the terminal.
- Schema: vendors, vendor_facts, vendor_knowledge, connections, questions, action_requests, agent_policies. Repos gain source, vision and sync time, and a grants migration for the server role.

## v1 (unreleased)

First complete build.

- Scan engine: inventory with `.gitignore` support, dependency manifests across ten ecosystems, deterministic checks (secrets, repository hygiene, OSV vulnerabilities, package freshness), a Tavily-backed docs check, Nemotron code review and cross-file pass, ranking, and the pre-launch audit.
- Confidence classes on every finding: Proven, Doc-verified, Judgment.
- Fixes: model-written edits applied in memory, tested in a Token Factory Sandbox when one is set up, opened as a pull request through the GitHub App, and patches for CLI snapshots.
- Web app: landing page, no-install demo scan, GitHub sign-in through Clerk, repository connection through a GitHub App, overview with the bird's-eye map, findings, finding detail with fix flow, dependency table, chat about the codebase, pre-launch audit, settings with account deletion, CLI device sign-in approval.
- Public API `/api/v1` with bearer tokens.
- Worker with a Postgres-backed job queue (safe across multiple workers), heartbeats and stop requests.
- `birdsi` CLI with device sign-in, snapshot upload, live progress, fix prompts and local patch application. MCP server over stdio with scan, status, findings, finding, fix and ask tools.
- Supabase schema with row level security on every table, an append-only usage ledger and scan event log.
