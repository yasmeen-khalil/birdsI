import Link from "next/link";
import { ChevronRight, Github } from "lucide-react";
import type { Confidence, Severity } from "@birdsi/shared";
import { ActionKind } from "@/components/ActionKind";
import { BirdsEyeMap, type MapFolder } from "@/components/BirdsEyeMap";
import { ConfidencePill } from "@/components/Confidence";
import { DemoButton } from "@/components/DemoButton";
import { Frame } from "@/components/Frame";
import { SeverityMeter } from "@/components/Severity";
import { SiteFooter, SiteHeader } from "@/components/marketing/SiteChrome";
import { icon } from "@/components/icon";
import { currentUserRow } from "@/lib/auth";

/** The sample repository seen from above: a fixed illustration, no data needed. */
const SAMPLE: Array<{ name: string; count: number; critical: number[]; medium: number[] }> = [
  { name: "app", count: 34, critical: [], medium: [21] },
  { name: "app/api", count: 12, critical: [3], medium: [] },
  { name: "components", count: 28, critical: [], medium: [9] },
  { name: "lib", count: 14, critical: [], medium: [5] },
  { name: "db", count: 9, critical: [2], medium: [] },
  { name: "public", count: 22, critical: [], medium: [] },
  { name: "tests", count: 11, critical: [], medium: [] },
  { name: ".", count: 12, critical: [1], medium: [] },
];

const sampleFolders: MapFolder[] = SAMPLE.map((f) => ({ name: f.name, files: Array.from({ length: f.count }, (_, i) => `${f.name}/${i}`) }));
const sampleHits: Record<string, Severity> = Object.fromEntries(
  SAMPLE.flatMap((f) => [...f.critical.map((i) => [`${f.name}/${i}`, "critical"] as const), ...f.medium.map((i) => [`${f.name}/${i}`, "medium"] as const)]),
);

const SAMPLE_FINDINGS: Array<{ severity: Severity; confidence: Confidence; title: string; where: string; kind: "fix" | "steps" }> = [
  { severity: "critical", confidence: "proven", title: "Your database key is committed in .env.production", where: ".env.production, line 3", kind: "fix" },
  { severity: "high", confidence: "doc_verified", title: "Stripe webhook does not check the signature", where: "app/api/stripe/webhook/route.ts, line 14", kind: "fix" },
  { severity: "medium", confidence: "judgment", title: "Two different prices for the same cake", where: "lib/prices.ts, line 8, and app/cakes/[id]/page.tsx, line 41", kind: "steps" },
];

const DIFF: Array<[string, string, string]> = [
  ["", "12", "export async function POST(req: Request) {"],
  ["del", "13", "-  const event = await req.json()"],
  ["del", "14", "-  handle(event)"],
  ["add", "13", "+  const body = await req.text()"],
  ["add", "14", '+  const sig = req.headers.get("stripe-signature")'],
  ["add", "15", "+  const event = stripe.webhooks.constructEvent("],
  ["add", "16", "+    body, sig, process.env.STRIPE_WEBHOOK_SECRET"],
  ["add", "17", "+  )"],
  ["add", "18", "+  handle(event)"],
];

async function signedIn(): Promise<boolean> {
  try {
    return (await currentUserRow()) !== null;
  } catch {
    return false;
  }
}

function ClassGlyph({ kind }: { kind: Confidence }) {
  return (
    <svg viewBox="0 0 40 40" className="h-9 w-9 max-[900px]:h-7 max-[900px]:w-7" style={{ color: kind === "judgment" ? "var(--text-2)" : "var(--text)" }} aria-hidden="true">
      {kind === "proven" && <circle cx="20" cy="20" r="17" fill="currentColor" />}
      {kind === "doc_verified" && (
        <>
          <circle cx="20" cy="20" r="16.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="20" cy="20" r="5.5" fill="currentColor" />
        </>
      )}
      {kind === "judgment" && <circle cx="20" cy="20" r="16.25" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4.2 3.6" />}
    </svg>
  );
}

export default async function LandingPage() {
  const isSignedIn = await signedIn();
  const primaryCta = isSignedIn ? (
    <Link className="btn btn-secondary btn-lg" href="/app">
      Open birdsI
    </Link>
  ) : (
    <Link className="btn btn-secondary btn-lg" href="/sign-in">
      <Github {...icon} />
      Sign in with GitHub
    </Link>
  );

  return (
    <div className="container-wide flex flex-grow flex-col" style={{ minHeight: "100vh" }}>
      <div className="min-[901px]:py-5">
        <SiteHeader signedIn={isSignedIn} />
      </div>

      <Frame as="section" arm={64} bend={30} className="mt-3 flex flex-col px-[72px] pt-14 pb-16 max-[900px]:gap-[22px] max-[900px]:px-[22px] max-[900px]:pt-[26px] max-[900px]:pb-7 max-[900px]:[--arm:30px]! max-[900px]:[--bend:16px]! min-[901px]:min-h-[760px]" aria-labelledby="hero-title">
        <div className="t-small c2 flex items-baseline justify-between gap-4 min-[901px]:text-[15px]">
          <span>
            <span className="max-[900px]:hidden">birdsI, the operations layer for coding agents</span>
            <span className="min-[901px]:hidden">Operations for coding agents</span>
          </span>
          <span>
            <span className="max-[900px]:hidden">Sample scan: 142 files, 38 dependencies, about 2 min</span>
            <span className="min-[901px]:hidden">Sample: about 2 min</span>
          </span>
        </div>
        <h1 id="hero-title" className="t-hero max-[900px]:text-[38px]! max-[900px]:leading-[1.1]! min-[901px]:mt-[72px]" style={{ maxWidth: 1080 }}>
          birdsI knows what your coding agent cannot: the code, the services it runs on, and where you want it to go.
        </h1>
        <div className="grid grid-cols-1 gap-[22px] min-[901px]:mt-auto min-[901px]:grid-cols-[440px_minmax(0,1fr)] min-[901px]:items-end min-[901px]:gap-x-24 min-[901px]:pt-16">
          <div className="flex flex-col gap-7">
            <p className="t-body-l c2 max-[900px]:text-[15px]!">Run npx birdsi in a project. It maps the code, finds every outside service the app runs on with its plan, limits and spend, audits it against current docs, and asks you only what it cannot know.</p>
            <div className="flex flex-wrap gap-3 max-[900px]:hidden">
              {primaryCta}
              <DemoButton />
            </div>
            <p className="t-small c3 max-[900px]:hidden">No sign-in needed for the sample. It is a small bakery shop app with problems planted on purpose.</p>
          </div>
          <figure className="m-0 flex flex-col gap-[18px]">
            <BirdsEyeMap folders={sampleFolders} hits={sampleHits} label="A sample shop app seen from above, one square per file" style={{ gap: "24px 30px" }} />
            <figcaption className="t-small c3 flex flex-wrap justify-between gap-x-6 gap-y-1">
              <span className="max-[900px]:hidden">corner-bakery seen from above. Each square is one file.</span>
              <span className="max-[900px]:hidden">Ringed squares have findings: 6 in 142 files.</span>
              <span className="min-[901px]:hidden">A sample shop app from above. Each square is a file. Ringed ones have findings.</span>
            </figcaption>
          </figure>
        </div>
      </Frame>

      <div className="mt-6 flex flex-col gap-2.5 min-[901px]:hidden">
        {primaryCta}
        <DemoButton />
        <p className="t-small c3" style={{ textAlign: "center", marginTop: 4 }}>
          No sign-in needed for the sample.
        </p>
      </div>

      <section id="how" className="grid grid-cols-1 gap-y-4 pt-[88px] min-[901px]:grid-cols-12 min-[901px]:gap-x-6 min-[901px]:gap-y-16 min-[901px]:pt-44">
        <div className="flex flex-col gap-5 min-[901px]:col-span-5">
          <h2 className="t-display max-[900px]:text-[34px]!">Every fact says how birdsI knows it.</h2>
          <p className="t-body-l c2 max-[900px]:text-[15px]!" style={{ maxWidth: 440 }}>
            Some things a fixed rule can prove. Some are checked against current docs. Some are a careful reading of your code. birdsI labels each one, so you and your agent know what to trust.
          </p>
        </div>
        <div className="flex flex-col min-[901px]:col-span-6 min-[901px]:col-start-7">
          {(
            [
              ["proven", "Proven", "A fixed rule or tool found it, not a model. Run it again and you get the same answer.", "Example: a secret scanner rule matched a Supabase service key."],
              ["doc_verified", "Doc-verified", "Checked against the current official docs for the exact library you use. The finding links to the page and the date it was read.", "Example: Stripe’s webhook guide, read today, says the signature must be checked."],
              ["judgment", "Judgment", "birdsI’s own reading of your code. Often right, sometimes not. It shows its evidence so you can decide.", "Example: two files charge different prices for the same cake."],
            ] as const
          ).map(([kind, title, body, example], i) => (
            <div key={kind} className="grid grid-cols-[40px_minmax(0,1fr)] gap-x-3.5 min-[901px]:grid-cols-[56px_minmax(0,1fr)] min-[901px]:gap-x-5" style={{ padding: i === 0 ? "0 0 28px" : i === 2 ? "28px 0 0" : "28px 0", ...(i < 2 ? { borderBottom: "1px solid var(--line)" } : {}) }}>
              <ClassGlyph kind={kind} />
              <div className="flex flex-col gap-2">
                <h3 className="t-h2 max-[900px]:text-[24px]!">{title}</h3>
                <p className="t-body c2">{body}</p>
                <p className="t-small c3">{example}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="panel mt-6 min-[901px]:col-span-12 min-[901px]:mt-0">
          <div className="flex items-center justify-between gap-3" style={{ padding: "16px 20px" }}>
            <span className="t-label c2">From the sample scan of corner-bakery</span>
            <span className="t-small c3">6 findings, 3 shown</span>
          </div>
          {SAMPLE_FINDINGS.map((f) => (
            <div key={f.title} className="frow max-[900px]:px-4!">
              <SeverityMeter severity={f.severity} className="hide-m" />
              <span className="min-w-0">
                <span className="mb-2 flex items-center justify-between gap-3 min-[901px]:hidden">
                  <SeverityMeter severity={f.severity} />
                  <ConfidencePill confidence={f.confidence} />
                </span>
                <span className="ti">{f.title}</span>
                <span className="wh path max-[900px]:whitespace-normal!">{f.where}</span>
              </span>
              <ConfidencePill confidence={f.confidence} className="hide-m" />
              <ActionKind kind={f.kind} className="hide-m" />
              <ChevronRight {...icon} className="i c3" />
            </div>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-y-4 pt-[88px] min-[901px]:grid-cols-12 min-[901px]:gap-x-6 min-[901px]:gap-y-12 min-[901px]:pt-44">
        <h2 className="t-display max-[900px]:text-[34px]! min-[901px]:col-span-5">Nothing changes until you say so.</h2>
        <p className="t-body-l c2 max-[900px]:text-[15px]! min-[901px]:col-span-5 min-[901px]:col-start-7 min-[901px]:self-end">
          When the fix is in your code, birdsI writes it, tests it, and opens a pull request you merge. When it lives outside the code, like database settings or a vendor plan, you get the steps. Your coding agent works the same way: it proposes, you approve.
        </p>
        <div className="mt-2.5 flex min-w-0 flex-col gap-4 min-[901px]:col-span-6 min-[901px]:mt-0">
          <ActionKind kind="fix" strong />
          <div className="code">
            <div className="hd">
              <span className="t-mono-s truncate" style={{ color: "var(--text)" }}>
                app/api/stripe/webhook/route.ts
              </span>
              <span>2 removed, 6 added</span>
            </div>
            <div className="bd">
              {DIFF.map(([kind, n, text], i) => (
                <div key={i} className={`ln${kind ? ` ${kind}` : ""} max-[900px]:grid-cols-[34px_minmax(0,1fr)]! max-[900px]:text-[11.5px] max-[900px]:[&>span:first-child]:pr-3!`}>
                  <span>{n}</span>
                  <span>{kind === "" ? <><span className="k">export async function</span> POST(req: Request) {"{"}</> : text}</span>
                </div>
              ))}
            </div>
          </div>
          <p className="t-small c3">Tested before it was opened: build passes, 21 of 21 tests pass.</p>
        </div>
        <div className="mt-3.5 flex flex-col gap-4 min-[901px]:col-span-6 min-[901px]:mt-0">
          <ActionKind kind="steps" strong />
          <ol className="flex flex-col" style={{ margin: 0, padding: 0, listStyle: "none", borderTop: "1px solid var(--line)" }}>
            {[
              <>
                Open your Supabase project and go to <b>Table Editor</b>, then <b>orders</b>.
              </>,
              <>
                Turn on <b>Row Level Security</b>. Until you add a rule, nobody can read the table from the browser.
              </>,
              <>Add the rule birdsI wrote for you, so each customer sees only their own orders.</>,
              <>
                Press <b>Check again</b> in birdsI. It confirms the rule is in place.
              </>,
            ].map((text, i) => (
              <li key={i} className="grid grid-cols-[30px_minmax(0,1fr)] min-[901px]:grid-cols-[40px_minmax(0,1fr)]" style={{ padding: "18px 0", borderBottom: "1px solid var(--line)" }}>
                <span className="t-h2" style={{ fontSize: 22, color: "var(--text-3)" }}>
                  {i + 1}
                </span>
                <span className="t-body">{text}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="where" className="grid grid-cols-1 gap-y-[22px] pt-[88px] pb-[88px] min-[901px]:grid-cols-12 min-[901px]:gap-x-6 min-[901px]:gap-y-12 min-[901px]:pt-44 min-[901px]:pb-44">
        <h2 className="t-display max-[900px]:text-[34px]! min-[901px]:col-span-6">Use it where you already work.</h2>
        {[
          ["In the browser", "A dashboard for each app: findings, vendors, alerts, questions, approvals and your vision. Ask about your code in plain words.", null],
          ["In the terminal", "One command in your project folder runs a full scan and opens the dashboard.", "npx birdsi"],
          ["Inside your coding agent", "Through MCP, the standard way agents use tools, Claude Code, Cursor or Codex read your vendors and limits, ask you questions and propose actions.", "npx birdsi mcp"],
        ].map(([title, body, cmd], i) => (
          <div key={title} className={`flex flex-col gap-3.5 pt-4 min-[901px]:col-span-4 min-[901px]:pt-6 ${i === 0 ? "min-[901px]:col-start-1" : ""}`} style={{ borderTop: "1px solid var(--text)" }}>
            <h3 className="t-h3">{title}</h3>
            <p className="t-body c2">{body}</p>
            {cmd && (
              <code className="t-mono" style={{ display: "block", padding: "12px 14px", background: "var(--code-bg)", borderRadius: "var(--r-md)", color: "var(--text)" }}>
                {cmd}
              </code>
            )}
          </div>
        ))}
      </section>

      <SiteFooter />
    </div>
  );
}
