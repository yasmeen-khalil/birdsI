import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignOutButton } from "@clerk/nextjs";
import { LogOut } from "lucide-react";
import { RequestAccess, WithdrawRequest } from "@/components/AccessControls";
import { Frame } from "@/components/Frame";
import { LocalTime } from "@/components/LocalTime";
import { SiteFooter, SiteHeader } from "@/components/marketing/SiteChrome";
import { icon } from "@/components/icon";
import { hasAccess } from "@/lib/access";
import { signedInUserUngated } from "@/lib/auth";

export const metadata: Metadata = { title: "Access", robots: { index: false } };
export const dynamic = "force-dynamic";

/**
 * Where a signed-in account that is not approved lands, and all it can see:
 * its own request and where it stands. It reads the account's own row and
 * nothing else.
 */
export default async function PendingPage() {
  const user = await signedInUserUngated();
  if (!user) redirect("/sign-in?redirect_url=/pending");
  if (hasAccess(user)) redirect("/app");
  const state = user.access === "denied" ? "denied" : user.access_requested_at ? "waiting" : "new";
  const login = user.github_login ?? user.email ?? null;

  return (
    <div className="container-wide flex flex-grow flex-col" style={{ minHeight: "100vh" }}>
      <div className="min-[901px]:py-5">
        <SiteHeader signedIn={false} back />
      </div>
      <main className="flex flex-grow items-start py-16">
        <Frame arm={40} bend={29} bracket="var(--text-2)" className="flex w-full flex-col gap-5 px-8 py-12 min-[901px]:px-16" style={{ maxWidth: 760 }}>
          {state === "new" && (
            <>
              <h1 className="t-display">Request access to birdsI</h1>
              <p className="t-body-l c2">birdsI is open by approval for now. Send a request, and you can use it as soon as it is approved.</p>
              <RequestAccess />
            </>
          )}
          {state === "waiting" && (
            <>
              <span className="tag" style={{ alignSelf: "flex-start" }}>
                Waiting for approval
              </span>
              <h1 className="t-display">Your request is in</h1>
              <p className="t-body-l c2">
                You asked on <LocalTime iso={user.access_requested_at!} />. Nothing in birdsI is open to this account until the request is approved. Come back to this page to check.
              </p>
            </>
          )}
          {state === "denied" && (
            <>
              <h1 className="t-display">This request was not approved</h1>
              <p className="t-body-l c2">This account cannot use birdsI.</p>
            </>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3" style={{ marginTop: 16, paddingTop: 20, borderTop: "1px solid var(--line)" }}>
            <span className="t-small c3">{login ? `Signed in with GitHub as ${login}` : "Signed in with GitHub"}</span>
            <span className="flex flex-wrap items-center gap-2">
              <WithdrawRequest />
              <SignOutButton redirectUrl="/">
                <button type="button" className="btn btn-secondary btn-sm">
                  <LogOut {...icon} />
                  Sign out
                </button>
              </SignOutButton>
            </span>
          </div>
        </Frame>
      </main>
      <SiteFooter />
    </div>
  );
}
