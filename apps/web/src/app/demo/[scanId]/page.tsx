import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { eventsAfter } from "@birdsi/db";
import { STEP_LABELS } from "@birdsi/engine";
import { SEVERITY_ORDER } from "@birdsi/shared";
import { BirdsEyeMap, hitsFromFindings } from "@/components/BirdsEyeMap";
import { DemoTopBar } from "@/components/DemoTopBar";
import { FindingRow } from "@/components/FindingRow";
import { SeverityMeter } from "@/components/Severity";
import { orNotFound, requireId } from "@/components/guard";
import { compareFindings, longDuration, plural } from "@/components/format";
import { LiveScan } from "@/components/scan/LiveScan";
import { loadScan } from "@/lib/scans";

export const metadata: Metadata = { title: "Sample scan" };

const INTRO = "A small bakery shop built with Next.js, Supabase and Stripe. Problems were planted on purpose so you can see what birdsI finds.";

export default async function DemoScanPage({ params, searchParams }: { params: Promise<{ scanId: string }>; searchParams: Promise<{ reused?: string }> }) {
  const scanId = requireId((await params).scanId);
  const { reused } = await searchParams;
  const data = await orNotFound(loadScan(scanId, null));
  if (data.scan.source !== "demo") notFound();
  const { scan } = data;

  if (scan.status !== "done") {
    const events = await eventsAfter(scanId, 0);
    return (
      <>
        <DemoTopBar />
        <main className="flex-grow px-16 pt-12 pb-10 max-[900px]:px-5 max-[900px]:pt-7">
          <LiveScan
            scanId={scanId}
            kind={scan.kind}
            initialStatus={scan.status}
            initialEvents={events}
            initialCursor={events[events.length - 1]?.seq ?? 0}
            stepLabels={STEP_LABELS}
            heading="Scanning corner-bakery"
            intro={INTRO}
            mapTitle="corner-bakery from above"
            mode="demo"
            expectedSeconds={120}
            scanError={scan.error}
            leaveNote="You can leave this page. The result stays at this address."
          />
        </main>
      </>
    );
  }

  const findings = [...data.findings].sort(compareFindings);
  const fixable = findings.filter((f) => f.actionKind === "fix").length;
  const needsYou = findings.length - fixable;
  const events = await eventsAfter(scanId, 0);
  const inventory = events.map((e) => e.event).find((e) => e.type === "inventory");
  const counts = Object.fromEntries(SEVERITY_ORDER.map((s) => [s, findings.filter((f) => f.severity === s).length]));

  return (
    <>
      <DemoTopBar />
      <main className="flex flex-grow flex-col gap-14 px-16 pt-12 pb-16 max-[900px]:gap-10 max-[900px]:px-5 max-[900px]:pt-7">
        {reused && (
          <p className="t-small c2 panel" style={{ padding: "12px 16px" }} role="status">
            The sample scanner is busy right now, so this is the most recent finished sample scan. It shows the same repository.
          </p>
        )}
        <section className="grid grid-cols-1 gap-y-10 min-[901px]:grid-cols-12 min-[901px]:gap-x-6">
          <div className="flex flex-col gap-4 min-[901px]:col-span-5">
            <h1 className="t-h1">{plural(findings.length, "finding")} in corner-bakery</h1>
            <p className="t-body c2">
              {findings.length === 0
                ? "birdsI found nothing to fix in the sample this time."
                : `birdsI can fix ${fixable} of them. ${needsYou} ${needsYou === 1 ? "needs" : "need"} you.`}
              {scan.stats ? ` Scan finished in ${longDuration(scan.stats.durationMs)}.` : ""}
            </p>
            <div className="flex flex-wrap gap-4" aria-label="Findings by severity">
              {SEVERITY_ORDER.map((s) => (
                <span key={s} className="inline-flex items-center gap-1">
                  <SeverityMeter severity={s} label={counts[s] ?? 0} />
                  <span className="sr-only">{s}</span>
                </span>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-end gap-2.5 min-[901px]:justify-start">
              <a className="btn btn-secondary" href="#findings">
                See all {findings.length}
              </a>
              <Link className="btn btn-primary" href="/sign-in">
                Scan your own code
              </Link>
            </div>
          </div>
          {inventory && inventory.type === "inventory" && (
            <figure className="m-0 flex min-w-0 flex-col gap-4 min-[901px]:col-span-6 min-[901px]:col-start-7">
              <h2 className="t-h3">corner-bakery from above</h2>
              <BirdsEyeMap folders={inventory.folders} hits={hitsFromFindings(findings)} label="corner-bakery seen from above, one square per file" />
              <figcaption className="t-small c3">Each square is one file. Ringed files have findings.</figcaption>
            </figure>
          )}
        </section>

        <section id="findings" className="flex flex-col" aria-labelledby="demo-findings">
          <div className="flex items-baseline justify-between gap-3" style={{ paddingBottom: 14 }}>
            <h2 id="demo-findings" className="t-h2">
              What birdsI found
            </h2>
            <span className="t-small c3">Most serious first</span>
          </div>
          {findings.length === 0 ? (
            <p className="t-body c2" style={{ padding: "16px 0", borderTop: "1px solid var(--line)" }}>
              No findings in this run.
            </p>
          ) : (
            findings.map((f, i) => <FindingRow key={f.id} finding={f} href={`/demo/${scanId}/findings/${f.id}`} last={i === findings.length - 1} />)
          )}
          <p className="t-small c3" style={{ marginTop: 24 }}>
            Judgment findings are birdsI’s reading of your code. Read the evidence before you act on them.
          </p>
        </section>
      </main>
    </>
  );
}
