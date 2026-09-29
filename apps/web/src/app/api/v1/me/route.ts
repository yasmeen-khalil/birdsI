import { handler, json, requireCaller } from "@/lib/api";

export const GET = handler(async (request) => {
  const user = await requireCaller(request);
  return json({ userId: user.id, login: user.github_login ?? user.email ?? "you" });
});
