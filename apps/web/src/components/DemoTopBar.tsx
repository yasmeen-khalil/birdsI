import Link from "next/link";
import { Github } from "lucide-react";
import { Wordmark } from "./Wordmark";
import { icon } from "./icon";

export const DEMO_REPO = "birdsi-demo/corner-bakery";

/** The visitor's top bar: this is the public sample, and the way to scan your own code. */
export function DemoTopBar() {
  return (
    <header className="topbar">
      <Wordmark href="/" className="max-[900px]:hidden!" />
      <Wordmark href="/" markOnly className="min-[901px]:hidden!" />
      <span className="inline-flex min-w-0 items-center gap-2.5">
        <span className="tag">Sample</span>
        <span className="path max-[900px]:hidden" style={{ color: "var(--text)" }}>
          {DEMO_REPO}
        </span>
        <span className="t-small c3 max-[900px]:hidden">public sample, read only</span>
      </span>
      <span className="inline-flex items-center gap-4" style={{ marginLeft: "auto" }}>
        <span className="tag">Demo</span>
        <span className="t-small c3 max-[900px]:hidden">Scan your own code next</span>
        <Link className="btn btn-secondary btn-sm" href="/sign-in" style={{ minHeight: 36 }}>
          <Github {...icon} />
          <span className="max-[900px]:hidden">Sign in with GitHub</span>
          <span className="min-[901px]:hidden">Sign in</span>
        </Link>
      </span>
    </header>
  );
}
