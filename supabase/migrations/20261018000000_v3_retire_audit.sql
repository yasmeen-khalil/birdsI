-- birdsI v3 (2026-10-18): the model-driven code audit, chat, fixes and the
-- pricing pages read by a model were removed from the code. Their tables keep
-- every row: nothing is dropped and nothing is deleted. Each is marked here so
-- anyone reading the schema knows nothing writes to it or reads it any more.
-- Removing the rows is the owner's choice, and REMINDERS has the lines for it.
-- Safe to run more than once.

comment on table public.chat_messages is 'Retired in birdsI v3 (2026-10-18). Chat was removed. Rows kept, nothing writes or reads here.';
comment on table public.repo_chunks is 'Retired in birdsI v3 (2026-10-18). Code passages indexed for chat. Rows kept, nothing writes or reads here.';
comment on function public.match_chunks(uuid, vector, integer) is 'Retired in birdsI v3 (2026-10-18) with chat.';
comment on table public.fixes is 'Retired in birdsI v3 (2026-10-18). Fixes and pull requests were removed. Rows kept, nothing writes or reads here.';
comment on table public.vendor_knowledge is 'Retired in birdsI v3 (2026-10-18). Plan tiers read from pricing pages by a model, replaced by the checked limits list in the code. Rows kept, nothing writes or reads here.';
