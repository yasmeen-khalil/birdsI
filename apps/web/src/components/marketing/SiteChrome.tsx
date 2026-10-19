import Link from "next/link";
import { LogIn } from "lucide-react";
import { Wordmark } from "../Wordmark";
import { icon } from "../icon";

/** Paper header: wordmark, section links, and sign in (or back into the app). */
export function SiteHeader({ signedIn, back = false }: { signedIn: boolean; back?: boolean }) {
  return (
    <header className="flex items-center justify-between gap-6" style={{ minHeight: 64 }}>
      <Wordmark href="/" className="max-[900px]:text-[20px]!" />
      {back ? (
        <span className="inline-flex items-center gap-4">
          <span className="tag">Demo</span>
          <Link className="btn btn-quiet btn-sm" href="/" style={{ minHeight: 44 }}>
            Back to the home page
          </Link>
        </span>
      ) : (
        <nav className="flex items-center gap-9" style={{ fontSize: 14, fontWeight: 500 }} aria-label="Site">
          <span className="tag">Demo</span>
          <Link href="/#how" className="max-[900px]:hidden" style={{ textDecoration: "none", color: "var(--text-2)" }}>
            How it works
          </Link>
          <Link href="/#where" className="max-[900px]:hidden" style={{ textDecoration: "none", color: "var(--text-2)" }}>
            For your agent
          </Link>
          {signedIn ? (
            <Link className="btn btn-secondary btn-sm" href="/app" style={{ minHeight: 36 }}>
              Open birdsI
            </Link>
          ) : (
            <Link className="btn btn-secondary btn-sm" href="/sign-in" style={{ minHeight: 36 }}>
              <LogIn {...icon} />
              Sign in
            </Link>
          )}
        </nav>
      )}
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-auto grid grid-cols-1 gap-3 pt-10 pb-12 min-[901px]:grid-cols-12 min-[901px]:items-start min-[901px]:gap-x-6" style={{ borderTop: "1px solid var(--line)" }}>
      <div className="flex flex-col gap-2.5 min-[901px]:col-span-3">
        <span className="wm" style={{ fontSize: 18 }}>
          birdsI
        </span>
        <span className="t-small c3">Licensed under MPL 2.0.</span>
      </div>
      <p className="t-small c2 min-[901px]:col-span-5 min-[901px]:col-start-5">Maps, account reads and alerts run without a model. The optional docs check reads a package&apos;s own documentation through Tavily and compares it with the code on Claude. Your code is never used to train models.</p>
      <nav className="t-small flex flex-wrap gap-x-6 gap-y-2 min-[901px]:col-span-3 min-[901px]:col-start-10 min-[901px]:justify-end" style={{ fontSize: 13 }} aria-label="Footer">
        <Link href="/terms" style={{ color: "var(--text-2)" }}>
          Terms
        </Link>
        <Link href="/privacy" style={{ color: "var(--text-2)" }}>
          Privacy
        </Link>
      </nav>
    </footer>
  );
}
