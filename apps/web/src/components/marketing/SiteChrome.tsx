import Link from "next/link";
import { LogIn } from "lucide-react";
import { Wordmark } from "../Wordmark";
import { icon } from "../icon";

export const GITHUB_REPO_URL = "https://github.com/yasmeen-khalil/birdsI";
export const NPM_URL = "https://www.npmjs.com/package/birdsi";

/** Paper header: wordmark, section links, and sign in (or back into the app). */
export function SiteHeader({ signedIn, back = false }: { signedIn: boolean; back?: boolean }) {
  return (
    <header className="flex items-center justify-between gap-6" style={{ minHeight: 64 }}>
      <Wordmark href="/" className="max-[900px]:text-[20px]!" />
      {back ? (
        <Link className="btn btn-quiet btn-sm" href="/" style={{ minHeight: 44 }}>
          Back to the home page
        </Link>
      ) : (
        <nav className="flex items-center gap-9" style={{ fontSize: 14, fontWeight: 500 }} aria-label="Site">
          <Link href="/#how" className="max-[900px]:hidden" style={{ textDecoration: "none", color: "var(--text-2)" }}>
            How it works
          </Link>
          <Link href="/#where" className="max-[900px]:hidden" style={{ textDecoration: "none", color: "var(--text-2)" }}>
            Terminal and MCP
          </Link>
          <a href={GITHUB_REPO_URL} className="max-[900px]:hidden" style={{ textDecoration: "none", color: "var(--text-2)" }}>
            Source on GitHub
          </a>
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
        <span className="t-small c3">Open source under MPL 2.0.</span>
      </div>
      <p className="t-small c2 min-[901px]:col-span-5 min-[901px]:col-start-5">Scans run on Claude models from Anthropic. Current docs and vendor pricing come from Tavily. Your code is never used to train models.</p>
      <nav className="t-small flex flex-wrap gap-x-6 gap-y-2 min-[901px]:col-span-3 min-[901px]:col-start-10 min-[901px]:justify-end" style={{ fontSize: 13 }} aria-label="Footer">
        <a href={GITHUB_REPO_URL} style={{ color: "var(--text-2)" }}>
          GitHub
        </a>
        <a href={NPM_URL} style={{ color: "var(--text-2)" }}>
          npm
        </a>
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
