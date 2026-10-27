import { AlertDraft, scopeOf, type AddDeadlineRequest, type AppAlert, type AppDeadline } from "@birdsi/shared";
import { ForbiddenError, getDb, NotFoundError } from "./client";
import { schemaHas } from "./schema";

/**
 * The alert stream and the dates to watch. The tables appear with migration
 * 20261018000400; until then no alert is stored and the cockpit says why.
 */

export const ALERTS_MIGRATION = "20261018000400_alerts.sql";
/** Closed alerts stay listed this long. */
export const RESOLVED_SHOWN_DAYS = 14;

interface AlertRow {
  id: string;
  app_id: string;
  app_project_id: string | null;
  kind: string;
  severity: string;
  sentence: string;
  action: string | null;
  details: Record<string, unknown> | null;
  source: Record<string, unknown> | null;
  dedupe_key: string;
  scope: string;
  opened_at: string;
  seen_at: string;
  resolved_at: string | null;
  email_status: string | null;
  emailed_at: string | null;
}

interface DeadlineRow {
  id: string;
  app_id: string;
  vendor: string | null;
  label: string;
  due_on: string;
  note: string | null;
  created_at: string;
}

export async function alertsAvailable(): Promise<boolean> {
  return schemaHas("alerts");
}

export function toAppAlert(row: AlertRow): AppAlert | null {
  const draft = AlertDraft.safeParse({
    kind: row.kind,
    severity: row.severity,
    projectId: row.app_project_id,
    sentence: row.sentence,
    action: row.action,
    details: row.details ?? {},
    source: { label: "", url: null, path: null, line: null, ...(row.source ?? {}) },
    dedupeKey: row.dedupe_key,
    scope: row.scope,
  });
  if (!draft.success) return null;
  return { ...draft.data, id: row.id, appId: row.app_id, openedAt: row.opened_at, seenAt: row.seen_at, resolvedAt: row.resolved_at, emailStatus: row.email_status, emailedAt: row.emailed_at };
}

function toDeadline(row: DeadlineRow): AppDeadline {
  return { id: row.id, appId: row.app_id, vendor: row.vendor, label: row.label, dueOn: row.due_on, note: row.note, createdAt: row.created_at };
}

/**
 * What one run does to the stored alerts, decided without the database: a
 * draft with no open alert of its key opens one; a draft with an open alert
 * refreshes it; an open alert whose scope this run checked and did not find
 * again is closed. An open alert in a scope this run could not check stays
 * as it is.
 */
export function planAlertSync(open: Array<{ id: string; dedupe_key: string; scope: string }>, drafts: AlertDraft[], checked: string[]): { toOpen: AlertDraft[]; toRefresh: Array<{ id: string; draft: AlertDraft }>; toResolve: string[] } {
  const byKey = new Map(open.map((o) => [o.dedupe_key, o]));
  const draftKeys = new Set(drafts.map((d) => d.dedupeKey));
  const scopes = new Set(checked);
  const toOpen: AlertDraft[] = [];
  const toRefresh: Array<{ id: string; draft: AlertDraft }> = [];
  for (const d of drafts) {
    const existing = byKey.get(d.dedupeKey);
    if (existing) toRefresh.push({ id: existing.id, draft: d });
    else if (!toOpen.some((x) => x.dedupeKey === d.dedupeKey)) toOpen.push(d);
  }
  const toResolve = open.filter((o) => !draftKeys.has(o.dedupe_key) && scopes.has(o.scope || scopeOf(o.dedupe_key))).map((o) => o.id);
  return { toOpen, toRefresh, toResolve };
}

/** Applies one run's alerts to an app. Returns the alerts it opened, for the email. */
export async function syncAlerts(appId: string, drafts: AlertDraft[], checked: string[], now = new Date()): Promise<AppAlert[]> {
  if (!(await alertsAvailable())) return [];
  const db = getDb();
  const found = await db.from("alerts").select("id, dedupe_key, scope").eq("app_id", appId).is("resolved_at", null);
  if (found.error) throw new Error(`syncAlerts: ${found.error.message}`);
  const plan = planAlertSync((found.data ?? []) as Array<{ id: string; dedupe_key: string; scope: string }>, drafts, checked);
  const at = now.toISOString();
  const opened: AppAlert[] = [];
  for (const d of plan.toOpen) {
    const { data, error } = await db
      .from("alerts")
      .insert({ app_id: appId, app_project_id: d.projectId, kind: d.kind, severity: d.severity, sentence: d.sentence, action: d.action, details: d.details, source: d.source, dedupe_key: d.dedupeKey, scope: d.scope, opened_at: at, seen_at: at })
      .select()
      .single();
    // Another run opened the same cause a moment ago: one open alert per cause is enough.
    if (error?.code === "23505") continue;
    if (error) throw new Error(`syncAlerts open: ${error.message}`);
    const alert = toAppAlert(data as AlertRow);
    if (alert) opened.push(alert);
  }
  for (const { id, draft } of plan.toRefresh) {
    const { error } = await db.from("alerts").update({ severity: draft.severity, sentence: draft.sentence, action: draft.action, details: draft.details, source: draft.source, seen_at: at }).eq("id", id);
    if (error) throw new Error(`syncAlerts refresh: ${error.message}`);
  }
  if (plan.toResolve.length > 0) {
    const { error } = await db.from("alerts").update({ resolved_at: at }).in("id", plan.toResolve);
    if (error) throw new Error(`syncAlerts resolve: ${error.message}`);
  }
  return opened;
}

export async function setAlertEmail(ids: string[], status: string, emailedAt: string | null): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await getDb().from("alerts").update({ email_status: status.slice(0, 300), emailed_at: emailedAt }).in("id", ids);
  if (error) throw new Error(`setAlertEmail: ${error.message}`);
}

/** Open alerts, and alerts closed in the last two weeks, newest first. */
export async function alertsForApp(appId: string, limit = 200): Promise<AppAlert[]> {
  if (!(await alertsAvailable())) return [];
  const since = new Date(Date.now() - RESOLVED_SHOWN_DAYS * 86_400_000).toISOString();
  const { data, error } = await getDb().from("alerts").select().eq("app_id", appId).or(`resolved_at.is.null,resolved_at.gte.${since}`).order("opened_at", { ascending: false }).limit(limit);
  if (error) throw new Error(`alertsForApp: ${error.message}`);
  return ((data ?? []) as AlertRow[]).map(toAppAlert).filter((a): a is AppAlert => a !== null);
}

export async function deadlinesForApp(appId: string): Promise<AppDeadline[]> {
  if (!(await alertsAvailable())) return [];
  const { data, error } = await getDb().from("app_deadlines").select().eq("app_id", appId).order("due_on", { ascending: true });
  if (error) throw new Error(`deadlinesForApp: ${error.message}`);
  return ((data ?? []) as DeadlineRow[]).map(toDeadline);
}

export async function ownedApp(appId: string, userId: string): Promise<void> {
  const { data, error } = await getDb().from("apps").select("owner_user_id").eq("id", appId).maybeSingle();
  if (error) throw new Error(`ownedApp: ${error.message}`);
  if (!data) throw new NotFoundError("app");
  if ((data as { owner_user_id: string }).owner_user_id !== userId) throw new ForbiddenError("app");
}

export async function addDeadline(appId: string, userId: string, input: AddDeadlineRequest): Promise<AppDeadline> {
  await ownedApp(appId, userId);
  const { data, error } = await getDb().from("app_deadlines").insert({ app_id: appId, vendor: input.vendor, label: input.label, due_on: input.dueOn, note: input.note }).select().single();
  if (error) throw new Error(`addDeadline: ${error.message}`);
  return toDeadline(data as DeadlineRow);
}

export async function removeDeadline(deadlineId: string, userId: string): Promise<AppDeadline> {
  const { data, error } = await getDb().from("app_deadlines").select().eq("id", deadlineId).maybeSingle();
  if (error) throw new Error(`removeDeadline: ${error.message}`);
  if (!data) throw new NotFoundError("date");
  const row = data as DeadlineRow;
  await ownedApp(row.app_id, userId);
  const del = await getDb().from("app_deadlines").delete().eq("id", deadlineId);
  if (del.error) throw new Error(`removeDeadline: ${del.error.message}`);
  return toDeadline(row);
}
