export async function GET() {
  if (process.env.APP_ROLE !== "ops") return new Response("not found", { status: 404 });
  return Response.json({ operators: (process.env.DEV_USER_IDS ?? "").split(",").length });
}
