import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { eventsAfter, scanForViewer, toScan } from "@birdsi/db";
import { STEP_LABELS } from "@birdsi/engine";
import { orNotFound, requireId } from "@/components/guard";
import { MAP_SECONDS, repoName } from "@/components/format";
import { LiveScan } from "@/components/scan/LiveScan";
import { repoContext } from "@/components/server/data";

export const metadata: Metadata = { title: "Map" };

export default async function ScanPage({ params }: { params: Promise<{ repoId: string; scanId: string }> }) {
  const p = await params;
  const { user, repo } = await repoContext(p.repoId);
  const scanId = requireId(p.scanId);
  const scan = toScan(await orNotFound(scanForViewer(scanId, user.id)));
  if (scan.repoId !== repo.id) notFound();
  if (scan.status === "done") redirect(`/app/${repo.id}`);

  const events = await eventsAfter(scan.id, 0);
  const name = repoName(repo.full_name);
  return (
    <main className="px-16 pt-12 pb-10 max-[900px]:px-5 max-[900px]:pt-7">
      <LiveScan
        scanId={scan.id}
        repoId={repo.id}
        appName={name}
        initialStatus={scan.status}
        initialEvents={events}
        initialCursor={events[events.length - 1]?.seq ?? 0}
        stepLabels={STEP_LABELS}
        heading={`Mapping ${name}`}
        intro="Every file, package and outside service, the deployments, crons, webhooks, store apps and migrations, and the rule-based checks. No model reads the code."
        expectedSeconds={MAP_SECONDS}
        scanError={scan.error}
        leaveNote="Safe to close this page. birdsI keeps going."
      />
    </main>
  );
}
