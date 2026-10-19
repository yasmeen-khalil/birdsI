import type { DeliveryCounts, OneSignalAppInfo, OneSignalAudience, OneSignalNotification, OneSignalRead } from "@birdsi/shared";
import { callJson, iso, notRead, num, reading, str, type ReadContext } from "./http";

/**
 * A OneSignal app in depth, with its App API key: the subscriptions and how
 * many can receive a message, the platforms it is set up for, what a send to
 * everyone would reach (OneSignal's estimate, which sends nothing, and says
 * when mobile push is being dropped for the organization's plan), and the
 * recent messages with OneSignal's delivery counts. The app's answer carries
 * push credentials; birdsI copies only the fields it names, so none is kept.
 */

const API = "https://api.onesignal.com";
const RECENT = 10;

function headers(token: string): Record<string, string> {
  return { authorization: `Key ${token}` };
}

function page(appId: string, tail = ""): string {
  return `https://dashboard.onesignal.com/apps/${encodeURIComponent(appId)}${tail}`;
}

/** Platforms the app is set up for: the channels OneSignal reports as enabled, or else its non-secret settings. */
function platformsOf(app: Record<string, unknown>): string[] {
  const out = new Set<string>();
  const channels = app["channels"];
  if (channels && typeof channels === "object") {
    for (const [name, channel] of Object.entries(channels as Record<string, unknown>)) {
      const c = channel as { enabled?: unknown; platforms?: unknown } | null;
      if (!c || c.enabled !== true) continue;
      const platforms = Array.isArray(c.platforms) ? c.platforms.filter((p): p is string => typeof p === "string") : [];
      if (platforms.length === 0) out.add(name);
      for (const p of platforms) out.add(p);
    }
    if (out.size > 0) return [...out].sort();
  }
  if (str(app["apns_bundle_id"]) || str(app["apns_key_id"]) || str(app["apns_env"])) out.add("ios");
  if (str(app["fcm_sender_id"])) out.add("android");
  if (str(app["chrome_web_origin"])) out.add("web");
  if (str(app["safari_site_origin"])) out.add("safari");
  return [...out].sort();
}

function count(value: unknown): number | null {
  const n = num(value);
  return n === null ? null : Math.max(0, Math.round(n));
}

function counts(value: unknown): DeliveryCounts {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return { successful: count(v["successful"]), failed: count(v["failed"]), errored: count(v["errored"]), converted: count(v["converted"]), received: count(v["received"]) };
}

const KINDS: Record<number, string> = { 0: "dashboard", 1: "api", 3: "automated" };

function notification(n: Record<string, unknown>): OneSignalNotification {
  const kind = typeof n["kind"] === "number" ? (KINDS[n["kind"] as number] ?? "unknown") : typeof n["kind"] === "string" ? String(n["kind"]) : "unknown";
  // A send to one person can carry their name in its text, so only a campaign's own name or heading is kept.
  const headings = (n["headings"] as Record<string, unknown> | undefined) ?? {};
  const title = kind === "api" ? null : (str(n["name"]) ?? str(headings["en"]))?.slice(0, 80) ?? null;
  const stats = (n["platform_delivery_stats"] as Record<string, unknown> | undefined) ?? {};
  const platforms: Record<string, DeliveryCounts> = {};
  for (const [platform, value] of Object.entries(stats)) if (value && typeof value === "object") platforms[platform] = counts(value);
  return {
    id: String(n["id"] ?? ""),
    kind,
    title,
    sentAt: iso(n["send_after"] ?? n["queued_at"]),
    completedAt: iso(n["completed_at"]),
    canceled: n["canceled"] === true,
    remaining: count(n["remaining"]),
    totals: counts(n),
    platforms,
  };
}

export async function readOneSignalApp(token: string, appId: string, ctx: ReadContext): Promise<OneSignalRead> {
  const id = encodeURIComponent(appId);
  const appApi = `${API}/apps/${id}`;
  const app = await reading<OneSignalAppInfo>({ api: appApi, page: page(appId) }, ctx, async () => {
    const res = await callJson<Record<string, unknown>>("OneSignal", appApi, headers(token), ctx);
    const b = res.body ?? {};
    // Field by field: the push credentials in this answer are never copied.
    return { id: String(b["id"] ?? appId), name: String(b["name"] ?? appId), subscriptions: count(b["players"]), subscribed: count(b["messageable_players"]), platforms: platformsOf(b), updatedAt: iso(b["updated_at"]) };
  });

  const audienceApi = `${API}/notifications/count-unsaved`;
  const notificationsApi = `${API}/notifications`;
  if (!app.ok) {
    const reason = `Not read, because the app could not be read: ${app.reason}`;
    return { vendor: "onesignal", app, audience: notRead({ api: audienceApi, page: page(appId, "/segments") }, reason), notifications: notRead({ api: notificationsApi, page: page(appId, "/notifications") }, reason) };
  }

  const audience = await reading<OneSignalAudience>({ api: audienceApi, page: page(appId, "/segments") }, ctx, async () => {
    const res = await callJson<Record<string, unknown>>("OneSignal", audienceApi, headers(token), ctx, { method: "POST", body: { app_id: appId, included_segments: ["All"], target_channel: "push" } });
    const b = res.body ?? {};
    return { pushRecipients: count(b["count"]), mobileSuppressed: typeof b["mobile_suppressed"] === "boolean" ? (b["mobile_suppressed"] as boolean) : null };
  });

  const notifications = await reading({ api: notificationsApi, page: page(appId, "/notifications") }, ctx, async () => {
    const res = await callJson<{ total_count?: unknown; notifications?: Array<Record<string, unknown>> }>("OneSignal", `${notificationsApi}?app_id=${id}&limit=${RECENT}&offset=0`, headers(token), ctx);
    return { total: count(res.body?.total_count), recent: (res.body?.notifications ?? []).slice(0, RECENT).map(notification).filter((n) => n.id) };
  });

  return { vendor: "onesignal", app, audience, notifications };
}
