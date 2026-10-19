import { Resend } from "resend";

export async function alertOwner(text: string) {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.DEV_ALERT_EMAIL;
  if (!key || !to) return { sent: false };
  await new Resend(key).emails.send({ from: "alerts@example.com", to, subject: "Alert", text });
  return { sent: true };
}
