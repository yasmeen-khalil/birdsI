import { startDeviceLogin } from "@birdsi/db";
import type { DeviceLoginStart } from "@birdsi/shared";
import { handler, json } from "@/lib/api";
import { appUrl } from "@/lib/env";

/** Step one of CLI sign-in: a code for the terminal and a URL for the browser. */
export const POST = handler(async () => {
  const { deviceCode, userCode } = await startDeviceLogin();
  const body: DeviceLoginStart = {
    deviceCode,
    userCode,
    verificationUrl: `${appUrl()}/device?code=${encodeURIComponent(userCode)}`,
    expiresIn: 600,
    interval: 3,
  };
  return json(body);
});
