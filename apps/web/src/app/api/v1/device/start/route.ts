import { allowDeviceStart, startDeviceLogin } from "@birdsi/db";
import type { DeviceLoginStart } from "@birdsi/shared";
import { ApiError, clientKey, handler, json } from "@/lib/api";
import { appUrl, envInt } from "@/lib/env";

/** Step one of CLI sign-in: a code for the terminal and a URL for the browser. */
export const POST = handler(async (request: Request) => {
  if (!(await allowDeviceStart(clientKey(request), envInt("BIRDSI_DEVICE_STARTS_PER_HOUR", 20)))) {
    throw new ApiError(429, "rate_limited", "Too many sign-in attempts from this network. Try again within the hour.");
  }
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
