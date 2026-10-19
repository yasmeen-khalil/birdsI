import { Webhook } from "svix";

export async function POST(req: Request) {
  const body = await req.text();
  const event = new Webhook(process.env.CLERK_WEBHOOK_SECRET!).verify(body, Object.fromEntries(req.headers));
  return Response.json({ ok: Boolean(event) });
}
