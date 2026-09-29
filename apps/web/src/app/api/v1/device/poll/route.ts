import { z } from "zod";
import { pollDeviceLogin, userById } from "@birdsi/db";
import type { DeviceLoginPoll } from "@birdsi/shared";
import { handler, json, parseBody } from "@/lib/api";

const Body = z.object({ deviceCode: z.string().min(16).max(200) });

/** The CLI polls until the browser approves. The token is handed over once. */
export const POST = handler(async (request) => {
  const { deviceCode } = await parseBody(request, Body);
  const result = await pollDeviceLogin(deviceCode);
  if (result.status !== "approved") return json({ status: result.status } satisfies DeviceLoginPoll);
  const user = await userById(result.userId);
  return json({ status: "approved", token: result.token, login: user?.github_login ?? user?.email ?? "you" } satisfies DeviceLoginPoll);
});
