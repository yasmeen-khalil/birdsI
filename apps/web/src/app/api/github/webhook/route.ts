import { NextResponse } from "next/server";
import { handleWebhook, verifyWebhookSignature } from "@/lib/github";

/** GitHub App webhooks. The signature is checked before the body is trusted. */
export async function POST(request: Request): Promise<NextResponse> {
  const raw = await request.text();
  if (!verifyWebhookSignature(raw, request.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: { code: "unauthorized", message: "Bad signature." } }, { status: 401 });
  }
  const event = request.headers.get("x-github-event") ?? "";
  try {
    await handleWebhook(event, JSON.parse(raw));
  } catch (error) {
    console.error("webhook", event, error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
