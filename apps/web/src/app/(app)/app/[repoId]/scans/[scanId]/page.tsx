import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { eventsAfter, scanForViewer, toScan } from "@birdsi/db";
import { STEP_LABELS } from "@birdsi/engine";
import { orNotFound, requireId } from "@/components/guard";
import { KIND_LABEL, KIND_SECONDS, repoName } from "@/components/format";
import { LiveScan } from "@/components/scan/LiveScan";
import { repoContext } from "@/components/server/data";

export const metadata: Metadata = { title: "Scan" };

const INTRO = {
  light: "Packages, exposed keys and known problems, checked against the published vulnerability database.",
  deep: "Every file read and compared with the others, each package checked against its current docs, and every vendor found.",
  audit: "The deepest check birdsI runs, ending in a plain answer: ready to launch, or not yet and why.",
} as const;

export default async function ScanPage({ params }: { params: Promise<{ repoId: string; scanId: string }> }) {
  const p = await params;
  const { user, repo } = await repoContext(p.repoId);
  const scanId = requireId(p.scanId);
  const scan = toScan(await orNotFound(scanForViewer(scanId, user.id)));
  if (scan.repoId !== repo.id) notFound();
  if (scan.status === "done") redirect(scan.kind === "audit" ? `/app/${repo.id}/audit?scan=${scan.id}` : `/app/${repo.id}/findings?scan=${scan.id}`);

  const events = await eventsAfter(scan.id, 0);
  const name = repoName(repo.full_name);
  return (
    <main className="px-16 pt-12 pb-10 max-[900px]:px-5 max-[900px]:pt-7">
      <LiveScan
        scanId={scan.id}
        kind={scan.kind}
        initialStatus={scan.status}
        initialEvents={events}
        initialCursor={events[events.length - 1]?.seq ?? 0}
        stepLabels={STEP_LABELS}
        heading={`${KIND_LABEL[scan.kind]} of ${name}`}
        intro={INTRO[scan.kind]}
        mapTitle={`${name} from above`}
        mode="app"
        repoId={repo.id}
        expectedSeconds={KIND_SECONDS[scan.kind]}
        scanError={scan.error}
        leaveNote="Safe to close this page. birdsI keeps going."
      />
    </main>
  );
}
