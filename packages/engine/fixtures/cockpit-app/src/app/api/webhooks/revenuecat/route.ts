export async function POST(req: Request) {
  if (req.headers.get("authorization") !== process.env.REVENUECAT_WEBHOOK_SECRET) return new Response("no", { status: 401 });
  return Response.json({ ok: true });
}
