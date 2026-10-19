import { db } from "@/lib/supabase";

export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return new Response("no", { status: 401 });
  await db.from("users").delete().lt("deletion_scheduled_for", new Date().toISOString());
  return Response.json({ ok: true });
}
