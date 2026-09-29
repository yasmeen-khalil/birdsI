import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

/**
 * Network boundary. Signed-in areas redirect to sign-in; the public API
 * authenticates itself with bearer tokens inside each handler, so it is
 * left alone here.
 */
const isProtected = createRouteMatcher(["/app(.*)", "/settings(.*)", "/connect(.*)", "/device(.*)", "/github/setup(.*)"]);

export default clerkMiddleware(async (auth, request) => {
  if (isProtected(request)) {
    const { userId } = await auth();
    if (!userId) {
      const signIn = new URL("/sign-in", request.url);
      signIn.searchParams.set("redirect_url", request.nextUrl.pathname + request.nextUrl.search);
      return NextResponse.redirect(signIn);
    }
  }
  return NextResponse.next();
});

export const config = {
  matcher: [
    // Everything except static files and Next internals.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
