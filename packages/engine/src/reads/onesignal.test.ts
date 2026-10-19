import { afterEach, describe, expect, it, vi } from "vitest";
import { readOneSignalApp } from "./onesignal";

const APP = "5eb5a37e-b458-11e3-ac11-000c2940e62c";
const CREDENTIAL = ["-----BEGIN", " PRIVATE KEY-----", "MIIEvQIBADANBg"].join("");

function oneSignalApi(overrides: Record<string, () => Response> = {}) {
  const seen: Array<{ url: string; method: string; auth: string | null; body: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      seen.push({ url, method: init?.method ?? "GET", auth: headers.get("authorization"), body: init?.body ? JSON.parse(String(init.body)) : null });
      for (const [part, respond] of Object.entries(overrides)) if (url.includes(part)) return respond();
      if (url.endsWith(`/apps/${APP}`)) {
        return Response.json({
          id: APP,
          name: "Flowsophy",
          players: 1480,
          messageable_players: 1210,
          updated_at: "2026-10-17T10:00:00.000Z",
          apns_env: "production",
          apns_p8: CREDENTIAL,
          fcm_v1_service_account_json: { private_key: CREDENTIAL },
          channels: { push: { enabled: true, platforms: ["ios", "android"] }, email: { enabled: false, platforms: [] } },
        });
      }
      if (url.endsWith("/notifications/count-unsaved")) return Response.json({ count: 1190, mobile_suppressed: true });
      if (url.includes("/notifications?app_id=")) {
        return Response.json({
          total_count: 31,
          notifications: [
            { id: "n1", kind: 0, name: "Weekly digest", headings: { en: "Your week in Flowmaps" }, contents: { en: "..." }, successful: 1150, failed: 22, errored: 3, converted: 41, received: null, remaining: 0, canceled: false, queued_at: 1_760_700_000, send_after: 1_760_700_000, completed_at: 1_760_700_300, platform_delivery_stats: { ios: { successful: 800, failed: 10, errored: 1, converted: 30 }, android: { successful: 350, failed: 12, errored: 2, converted: 11 } } },
            { id: "n2", kind: 1, headings: { en: "Mina liked your Flowmap" }, contents: { en: "Mina liked your Flowmap" }, successful: 1, failed: 0, errored: 0, converted: 0, remaining: 0, queued_at: 1_760_600_000 },
          ],
        });
      }
      return new Response("{}", { status: 404 });
    }),
  );
  return seen;
}

afterEach(() => vi.unstubAllGlobals());

describe("reading a OneSignal app", () => {
  it("reads the counts, the platforms, the audience and the recent messages, and keeps no credential", async () => {
    const seen = oneSignalApi();
    const read = await readOneSignalApp("os_v2_app_key", APP, { now: new Date() });
    expect(read.app).toMatchObject({ ok: true, value: { name: "Flowsophy", subscriptions: 1480, subscribed: 1210, platforms: ["android", "ios"] } });
    expect(read.audience).toMatchObject({ ok: true, value: { pushRecipients: 1190, mobileSuppressed: true } });
    expect(read.notifications).toMatchObject({ ok: true, value: { total: 31 } });
    const recent = read.notifications.ok ? read.notifications.value.recent : [];
    expect(recent[0]).toMatchObject({ id: "n1", kind: "dashboard", title: "Weekly digest", totals: { successful: 1150, failed: 22, errored: 3, converted: 41 }, platforms: { ios: { successful: 800 } } });
    // A send to one person keeps no text: it can name them.
    expect(recent[1]).toMatchObject({ id: "n2", kind: "api", title: null });
    const text = JSON.stringify(read);
    expect(text).not.toContain("PRIVATE KEY");
    expect(text).not.toContain("Mina");
    expect(seen.every((s) => s.auth === "Key os_v2_app_key")).toBe(true);
    expect(seen.find((s) => s.url.endsWith("/count-unsaved"))).toMatchObject({ method: "POST", body: { app_id: APP, included_segments: ["All"], target_channel: "push" } });
  });

  it("reads nothing more when the app cannot be read, and says why", async () => {
    oneSignalApi({ [`/apps/${APP}`]: () => new Response(JSON.stringify({ errors: ["Forbidden"] }), { status: 403 }) });
    const read = await readOneSignalApp("os_v2_app_key", APP, { now: new Date() });
    expect(read.app).toMatchObject({ ok: false, reason: expect.stringContaining("HTTP 403") });
    expect(read.notifications).toMatchObject({ ok: false, reason: expect.stringContaining("the app could not be read") });
  });
});
