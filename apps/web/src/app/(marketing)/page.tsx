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
  ["From the code", "Services and SDKs, the env names each needs by deployment, crons, webhooks, the store app, the migrations the repository holds, the public surface.", "Read by rules, with the file and line for each, never by a model."],
  ["From the accounts", "Deployments with their state and age, env names present and missing per project, whether a database is paused, its advisors, the migrations still owed, push subscribers and deliveries.", "Read with a key that only reads, per project, dated, with the address it came from."],
  ["What needs you", "A stream of alerts, each a sentence: what happened to what, under which rule, with the numbers. Emailed to you when birdsI has a sending key.", "When birdsI cannot read something, it says so. Never a zero."],
];

/** A hairline with an index readout at its left edge, like the margin marks of a printed sheet. */
function SectionRule({ index }: { index: string }) {
  return (
    <div className="sect-rule t-readout min-[901px]:col-span-12" aria-hidden="true">
      <span>{index}</span>
    </div>
  );
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
      Sign in
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
          <div className="t-small c2 flex items-baseline justify-between gap-4">
            <span>birdsI, the cockpit for your apps</span>
            <span className="t-mono-s c2 max-[900px]:hidden">One page per app</span>
          </div>
          <h1 id="hero-title" className="t-hero max-[900px]:text-[36px]! max-[900px]:leading-[1.08]! min-[901px]:mt-[clamp(48px,9vh,112px)]" style={{ maxWidth: 1120 }}>
            Every app you run, and every service it runs on, on one page that tells you what needs you.
          </h1>
          <div className="grid grid-cols-1 gap-8 min-[901px]:mt-auto min-[901px]:grid-cols-[minmax(0,1fr)_minmax(0,500px)] min-[901px]:items-end min-[901px]:gap-x-20 min-[901px]:pt-16">
            <div className="flex flex-col gap-6" style={{ maxWidth: 500 }}>
              <p className="t-body-l c2 max-[900px]:text-[16px]!">birdsI maps each app from its code, then reads the vendors it runs on with keys that only read: deployments, env names, crons, databases, push. What goes wrong becomes one alert, written as a sentence.</p>
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
          <SectionRule index="01" />
          <div className="flex flex-col gap-5 min-[901px]:col-span-5">
            <h2 className="t-display max-[900px]:text-[32px]!">Every fact says where it came from.</h2>
            <p className="t-body-l c2 max-[900px]:text-[15px]!" style={{ maxWidth: 440 }}>
              The map is read from the code by rules. The live facts come from each vendor&apos;s own API, with the date and the address. Plan limits come from a list a person checked against each pricing page, with the date it was checked.
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
          <SectionRule index="02" />
          <div className="flex flex-col gap-5 min-[901px]:col-span-5">
            <h2 className="t-display max-[900px]:text-[32px]!">For your coding agent.</h2>
            <p className="t-body-l c2 max-[900px]:text-[15px]!" style={{ maxWidth: 440 }}>
              Your agent reads the same page through the MCP server, the terminal tool with --json, or the skill file: the map, the live facts, the alerts, and the record of what was decided. It can ask you and propose, and only you approve, in the browser.
            </p>
          </div>
          <div className="flex flex-col gap-3 min-[901px]:col-span-6 min-[901px]:col-start-7">
            <p className="t-body c2">birdsI holds keys that only read. Writes come later, each behind your approval and a log. It reads an app&apos;s own database only through that app&apos;s ops API or exports, never with the app&apos;s database key.</p>
          </div>
        </section>

        <SiteFooter />
      </div>
    </div>
  );
}
