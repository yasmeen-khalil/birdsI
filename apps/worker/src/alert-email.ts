import { alertEmailState, type AppAlert } from "@birdsi/shared";

/**
 * New alerts, emailed through Resend when birdsI has a key for it and the
 * owner asked for email in Settings. One email per app per read, listing what
 * opened. Every alert records whether it went out, or why not, and the page
 * shows it.
 */

export interface EmailEnv {
  resendKey: string | null;
  from: string;
  appUrl: string | null;
}

export function emailEnv(env: NodeJS.ProcessEnv = process.env): EmailEnv {
  return {
    resendKey: env["RESEND_API_KEY"]?.trim() || null,
    // Resend's shared sender delivers only to the address of the Resend account itself, which suits one operator.
    from: env["BIRDSI_ALERT_FROM"]?.trim() || "birdsI <onboarding@resend.dev>",
    appUrl: env["NEXT_PUBLIC_APP_URL"]?.trim().replace(/\/+$/, "") || null,
  };
}

export function alertEmailText(appName: string, alerts: AppAlert[], link: string | null): { subject: string; text: string } {
  const subject = alerts.length === 1 ? `birdsI: a new alert for ${appName}` : `birdsI: ${alerts.length} new alerts for ${appName}`;
  const lines = alerts.map((a) => `- ${a.severity === "critical" ? "Critical" : "Warning"}. ${a.sentence}${a.action ? ` ${a.action}` : ""}`);
  const text = [`${appName}, read by birdsI at ${new Date().toUTCString()}:`, "", ...lines, "", link ? `All alerts: ${link}` : "", "You get this because email alerts are on in birdsI's Settings."].filter((l, i, all) => l !== "" || all[i - 1] !== "").join("\n");
  return { subject, text };
}

/** Sends the email, or says why it was not sent. Returns the status to store on each alert. */
export async function sendAlertEmail(env: EmailEnv, user: { email: string | null; email_updates: boolean }, app: { name: string; repoId: string }, alerts: AppAlert[]): Promise<{ status: string; sentAt: string | null }> {
  const emailed = alerts.filter((a) => a.severity !== "notice");
  if (emailed.length === 0) return { status: "not sent: notices are not emailed", sentAt: null };
  const state = alertEmailState(Boolean(env.resendKey), user);
  if (!state.on) return { status: `not sent: ${state.sentence.replace(/^Alerts are not emailed: /, "")}`, sentAt: null };
  const link = env.appUrl ? `${env.appUrl}/app/${app.repoId}/alerts` : null;
  const { subject, text } = alertEmailText(app.name, emailed, link);
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${env.resendKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: env.from, to: [user.email], subject, text }),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.ok) return { status: "sent", sentAt: new Date().toISOString() };
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    return { status: `not sent: Resend answered HTTP ${res.status}${body?.message ? ` (${body.message.slice(0, 160)})` : ""}`, sentAt: null };
  } catch (error) {
    return { status: `not sent: Resend could not be reached (${error instanceof Error ? error.message.slice(0, 120) : String(error)})`, sentAt: null };
  }
}
