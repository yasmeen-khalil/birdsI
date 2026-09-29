import { NextResponse } from "next/server";
import { currentUserRow } from "@/lib/auth";
import { completeInstallation } from "@/lib/github";

/**
 * GitHub redirects here after the App is installed. The installation is
 * tied to the signed-in user and its repositories are connected.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const user = await currentUserRow();
  if (!user) {
    const signIn = new URL("/sign-in", url.origin);
    signIn.searchParams.set("redirect_url", url.pathname + url.search);
    return NextResponse.redirect(signIn);
  }
  const installationId = Number.parseInt(url.searchParams.get("installation_id") ?? "", 10);
  const action = url.searchParams.get("setup_action");
  if (action === "request") {
    return NextResponse.redirect(new URL("/connect?status=requested", url.origin));
  }
  if (!Number.isFinite(installationId)) {
    return NextResponse.redirect(new URL("/connect?status=missing", url.origin));
  }
  try {
    const { connected } = await completeInstallation(user, installationId);
    return NextResponse.redirect(new URL(`/connect?status=connected&count=${connected}`, url.origin));
  } catch (error) {
    console.error("github setup", error);
    return NextResponse.redirect(new URL("/connect?status=error", url.origin));
  }
}
