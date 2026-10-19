import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppAlert } from "@birdsi/shared";
import { alertEmailText, sendAlertEmail } from "./alert-email";

const alert = (severity: AppAlert["severity"], sentence: string): AppAlert => ({
  id: sentence,
  appId: "a",
  kind: "deployment_failed",
  severity,
  projectId: null,
  sentence,
  action: "Open the deployment.",
  details: {},
  source: { label: "x", url: null, path: null, line: null },
  dedupeKey: sentence,
  scope: "deployment_failed:p",
  openedAt: "2026-10-18T21:00:00.000Z",
  seenAt: "2026-10-18T21:00:00.000Z",
  resolvedAt: null,
  emailStatus: null,
  emailedAt: null,
});

const owner = { email: "owner@example.com", email_updates: true };
const env = { resendKey: "re_test", from: "birdsI <onboarding@resend.dev>", appUrl: "https://birdsi.vercel.app" };

afterEach(() => vi.unstubAllGlobals());

describe("emailing new alerts", () => {
  it("says why it did not send: no key, no address, or email off in Settings", async () => {
    expect(await sendAlertEmail({ ...env, resendKey: null }, owner, { name: "Flowsophy", repoId: "r" }, [alert("critical", "x")])).toEqual({ status: "not sent: RESEND_API_KEY is not set on birdsI.", sentAt: null });
    expect((await sendAlertEmail(env, { email: null, email_updates: true }, { name: "Flowsophy", repoId: "r" }, [alert("critical", "x")])).status).toBe("not sent: the account has no email address.");
    expect((await sendAlertEmail(env, { ...owner, email_updates: false }, { name: "Flowsophy", repoId: "r" }, [alert("warning", "x")])).status).toBe("not sent: email alerts are off in Settings.");
  });

  it("sends one email per read with every new alert, and says when Resend refuses it", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string | URL, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return bodies.length === 1 ? Response.json({ id: "em_1" }) : Response.json({ message: "The from address is not verified." }, { status: 422 });
      }),
    );
    const sent = await sendAlertEmail(env, owner, { name: "Flowsophy", repoId: "r1" }, [alert("critical", "The deployment failed."), alert("warning", "A cron is not registered.")]);
    expect(sent.status).toBe("sent");
    expect(bodies[0]).toMatchObject({ from: env.from, to: ["owner@example.com"], subject: "birdsI: 2 new alerts for Flowsophy" });
    expect(String(bodies[0]!["text"])).toContain("- Critical. The deployment failed. Open the deployment.");
    expect(String(bodies[0]!["text"])).toContain("All alerts: https://birdsi.vercel.app/app/r1/alerts");
    const refused = await sendAlertEmail(env, owner, { name: "Flowsophy", repoId: "r1" }, [alert("critical", "x")]);
    expect(refused.status).toBe("not sent: Resend answered HTTP 422 (The from address is not verified.)");
  });

  it("writes a subject for one alert", () => {
    expect(alertEmailText("Lamp Post", [alert("critical", "x")], null).subject).toBe("birdsI: a new alert for Lamp Post");
  });
});
