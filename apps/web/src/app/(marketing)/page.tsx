import Link from "next/link";
import { Github } from "lucide-react";
import { CopyButton } from "@/components/CopyButton";
import { Frame } from "@/components/Frame";
import { SiteFooter, SiteHeader } from "@/components/marketing/SiteChrome";
import { icon } from "@/components/icon";
import { currentUserRow } from "@/lib/auth";

/** The commands, labelled as they are in "For your coding agent". */
const COMMANDS: Array<[string, string]> = [
  ["Map an app, in its folder", "npx birdsi"],
  ["Inside your coding agent", "npx birdsi mcp"],
];

/** What one app's page holds, from the code and from the vendors' own APIs. */
const READS: Array<[string, string, string]> = [
  ["From your code", "Every service your app uses, the env variables each deployment needs, and its crons, webhooks, store apps and migrations.", "Each one comes with the file and line it was found on."],
  ["From your accounts", "Failed deployments, missing env variables, a paused database, migrations you have not run, push subscribers and deliveries.", "Read every hour with keys that only read. Every fact is dated."],
  ["What needs you", "One alert per problem, in a plain sentence: what happened, where, and the numbers behind it. By email if you turn it on.", "If birdsI cannot read something, it says so. It never shows a zero instead."],
];

/** A hairline between sections. */
function SectionRule() {
  return <div className="sect-rule min-[901px]:col-span-12" aria-hidden="true" />;
}

async function signedIn(): Promise<boolean> {
  try {
    return (await currentUserRow()) !== null;
  } catch {
    return false;
  }
}

export default async function LandingPage() {
  const isSignedIn = await signedIn();
  const primaryCta = isSignedIn ? (
    <Link className="btn btn-primary btn-lg" href="/app">
      Open birdsI
    </Link>
  ) : (
    <Link className="btn btn-primary btn-lg" href="/sign-in">
      <Github {...icon} />
      Map my app
    </Link>
  );

  return (
    <div className="fog flex flex-grow flex-col">
      <div className="container-wide flex flex-grow flex-col" style={{ minHeight: "100vh" }}>
        <div className="min-[901px]:py-5">
          <SiteHeader signedIn={isSignedIn} />
        </div>

        <Frame
          as="section"
          arm={96}
          bend={72}
          className="mt-3 flex flex-col gap-7 px-[72px] pt-12 pb-14 max-[900px]:px-[22px] max-[900px]:pt-[26px] max-[900px]:pb-8 max-[900px]:[--arm:40px]! max-[900px]:[--bend:30px]! min-[901px]:min-h-[min(760px,calc(100vh-112px))] min-[901px]:gap-0"
          aria-labelledby="hero-title"
        >
          <div className="t-small c2">birdsI, the cockpit for your apps</div>
          <h1 id="hero-title" className="t-hero max-[900px]:text-[36px]! max-[900px]:leading-[1.08]! min-[901px]:mt-[clamp(48px,9vh,112px)]" style={{ maxWidth: 1120 }}>
            Know what is broken in your apps before your users do.
          </h1>
          <div className="grid grid-cols-1 gap-8 min-[901px]:mt-auto min-[901px]:grid-cols-[minmax(0,1fr)_minmax(0,500px)] min-[901px]:items-end min-[901px]:gap-x-20 min-[901px]:pt-16">
            <div className="flex flex-col gap-6" style={{ maxWidth: 500 }}>
              <p className="t-body-l c2 max-[900px]:text-[16px]!">birdsI reads your code and your Vercel, Supabase and GitHub accounts every hour. A failed deployment, a paused database or a missing env variable reaches you as one plain alert. It only reads, and the first map takes about a minute.</p>
              <div className="flex flex-wrap gap-3 max-[900px]:flex-col max-[900px]:[&>*]:w-full max-[900px]:[&_.btn]:w-full">{primaryCta}</div>
            </div>
            <div className="night instrument" role="group" aria-label="Terminal and MCP">
              <div className="flex items-center justify-between gap-3" style={{ padding: "14px 18px 12px" }}>
                <span className="t-readout c3">Terminal and MCP</span>
                <span className="flex gap-1.5" aria-hidden="true">
                  <i className="dot" style={{ color: "var(--line-strong)" }} />
                  <i className="dot" style={{ color: "var(--line-strong)" }} />
                  <i className="dot" style={{ color: "var(--accent)" }} />
                </span>
              </div>
              {COMMANDS.map(([label, cmd]) => (
                <div key={cmd} className="instrument-row">
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <span className="t-small c3">{label}</span>
                    <code className="instrument-cmd">{cmd}</code>
                  </div>
                  <CopyButton text={cmd} />
                </div>
              ))}
            </div>
          </div>
        </Frame>

        <section id="how" className="grid grid-cols-1 gap-y-5 pt-[72px] min-[901px]:grid-cols-12 min-[901px]:gap-x-6 min-[901px]:gap-y-14 min-[901px]:pt-32" style={{ scrollMarginTop: 24 }}>
          <SectionRule />
          <div className="flex flex-col gap-5 min-[901px]:col-span-5">
            <h2 className="t-display max-[900px]:text-[32px]!">No guesses. Every fact shows its source.</h2>
            <p className="t-body-l c2 max-[900px]:text-[15px]!" style={{ maxWidth: 440 }}>
              The map of your app comes from your code, with the file and line. Live facts come from each vendor&apos;s own API, with the date. Plan limits come from each vendor&apos;s pricing page, checked by a person.
            </p>
          </div>
          <div className="flex flex-col min-[901px]:col-span-6 min-[901px]:col-start-7" style={{ borderTop: "1px solid var(--line)" }}>
            {READS.map(([title, body, how]) => (
              <div key={title} className="flex flex-col gap-1.5 py-6" style={{ borderBottom: "1px solid var(--line)" }}>
                <h3 className="t-h2 max-[900px]:text-[23px]!">{title}</h3>
                <p className="t-body c2">{body}</p>
                <p className="t-small c3">{how}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="where" className="grid grid-cols-1 gap-y-5 pt-[72px] pb-24 min-[901px]:grid-cols-12 min-[901px]:gap-x-6 min-[901px]:gap-y-14 min-[901px]:pt-32" style={{ scrollMarginTop: 24 }}>
          <SectionRule />
          <div className="flex flex-col gap-5 min-[901px]:col-span-5">
            <h2 className="t-display max-[900px]:text-[32px]!">Your coding agent can read it too.</h2>
            <p className="t-body-l c2 max-[900px]:text-[15px]!" style={{ maxWidth: 440 }}>
              Claude Code, Cursor and Codex get the same page through the MCP server or the terminal: the map, the live facts, the alerts and what you decided. Your agent can ask and propose. Only you approve, in the browser.
            </p>
          </div>
          <div className="flex flex-col gap-3 min-[901px]:col-span-6 min-[901px]:col-start-7">
            <p className="t-body c2">birdsI only reads. It never uses your app&apos;s database key, and nothing in your accounts changes without your approval.</p>
            <div className="flex flex-wrap gap-3 pt-3 max-[900px]:flex-col max-[900px]:[&>*]:w-full max-[900px]:[&_.btn]:w-full">{primaryCta}</div>
          </div>
        </section>

        <SiteFooter />
      </div>
    </div>
  );
}
