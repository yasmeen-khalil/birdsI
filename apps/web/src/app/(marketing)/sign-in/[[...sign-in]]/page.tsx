import Link from "next/link";
import { SignIn } from "@clerk/nextjs";
import { Check, GitPullRequest, Mail } from "lucide-react";
import type { Metadata } from "next";
import { Frame } from "@/components/Frame";
import { SiteHeader } from "@/components/marketing/SiteChrome";
import { icon } from "@/components/icon";

export const metadata: Metadata = { title: "Sign in" };

const appearance = {
  variables: {
    colorPrimary: "#4E33E6",
    borderRadius: "6px",
    fontFamily: "var(--sans)",
    colorText: "#0C0D11",
    colorBackground: "#FFFFFF",
  },
  elements: {
    card: { boxShadow: "none", border: "1px solid #DDE0E5" },
  },
};

export default function SignInPage() {
  return (
    <div className="container-wide flex flex-grow flex-col" style={{ minHeight: "100vh" }}>
      <div className="min-[901px]:py-5">
        <SiteHeader signedIn={false} back />
      </div>
      <Frame as="section" arm={72} bend={52} className="mt-3 mb-12 grid grid-cols-1 gap-y-10 px-[22px] py-8 max-[900px]:[--arm:40px]! max-[900px]:[--bend:30px]! min-[901px]:mt-10 min-[901px]:grid-cols-12 min-[901px]:gap-x-6 min-[901px]:px-24 min-[901px]:py-[72px]" aria-labelledby="signin-title">
        <div className="flex flex-col gap-6 min-[901px]:col-span-5">
          <h1 id="signin-title" className="t-display">
            Sign in to birdsI
          </h1>
          <p className="t-body-l c2">birdsI uses your GitHub account. There is no separate password. Next, you choose which repositories it can read.</p>
          <div className="flex flex-col gap-3.5" style={{ marginTop: 4 }}>
            <SignIn path="/sign-in" routing="path" fallbackRedirectUrl="/app" withSignUp appearance={appearance} />
            <p className="t-small c3">
              By continuing you agree to the <Link href="/terms">Terms</Link> and the <Link href="/privacy">Privacy policy</Link>.
            </p>
          </div>
          <p className="t-small c2 min-[901px]:mt-auto">
            Only want a look first?{" "}
            <Link href="/" style={{ fontWeight: 600, color: "var(--text)" }}>
              Try the sample
            </Link>{" "}
            without signing in.
          </p>
        </div>
        <div className="flex flex-col gap-2 min-[901px]:col-span-5 min-[901px]:col-start-8 min-[901px]:pt-2.5">
          <h2 className="t-h3">What birdsI can do once connected</h2>
          <ul className="flex flex-col" style={{ listStyle: "none", margin: "12px 0 0", padding: 0, borderTop: "1px solid var(--line)" }}>
            <li className="grid grid-cols-[32px_minmax(0,1fr)]" style={{ padding: "18px 0", borderBottom: "1px solid var(--line)" }}>
              <Check {...icon} style={{ marginTop: 4 }} />
              <span className="t-body">
                <b>Read the code</b> in the repositories you choose. It cannot see the others.
              </span>
            </li>
            <li className="grid grid-cols-[32px_minmax(0,1fr)]" style={{ padding: "18px 0", borderBottom: "1px solid var(--line)" }}>
              <GitPullRequest {...icon} style={{ marginTop: 4 }} />
              <span className="t-body">
                <b>Open pull requests</b> with fixes. It never merges them and never pushes to your main branch.
              </span>
            </li>
            <li className="grid grid-cols-[32px_minmax(0,1fr)]" style={{ padding: "18px 0", borderBottom: "1px solid var(--line)" }}>
              <Mail {...icon} style={{ marginTop: 4 }} />
              <span className="t-body">
                <b>Read your email address</b>, kept with your account. birdsI sends no email yet.
              </span>
            </li>
          </ul>
          <p className="t-small c3" style={{ marginTop: 16 }}>
            You can remove access at any time from GitHub, or delete your birdsI account in Settings. Your code is never used to train models.
          </p>
        </div>
      </Frame>
    </div>
  );
}
