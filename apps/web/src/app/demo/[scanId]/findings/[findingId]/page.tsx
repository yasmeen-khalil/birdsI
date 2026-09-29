import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DemoTopBar } from "@/components/DemoTopBar";
import { FindingDetail } from "@/components/FindingDetail";
import { orNotFound, requireId } from "@/components/guard";
import { compareFindings } from "@/components/format";
import { loadFinding, loadScan } from "@/lib/scans";

export const metadata: Metadata = { title: "Sample finding" };

export default async function DemoFindingPage({ params }: { params: Promise<{ scanId: string; findingId: string }> }) {
  const p = await params;
  const scanId = requireId(p.scanId);
  const findingId = requireId(p.findingId);
  const [{ finding }, data] = await Promise.all([orNotFound(loadFinding(findingId, null)), orNotFound(loadScan(scanId, null))]);
  if (data.scan.source !== "demo" || finding.scanId !== scanId) notFound();

  const ordered = [...data.findings].sort(compareFindings);
  const index = Math.max(0, ordered.findIndex((f) => f.id === finding.id));
  const href = (i: number) => (ordered[i] ? `/demo/${scanId}/findings/${ordered[i]!.id}` : null);

  return (
    <>
      <DemoTopBar />
      <FindingDetail
        finding={finding}
        fix={null}
        scan={data.scan}
        mode="demo"
        repo={null}
        position={{ index, total: ordered.length, prevHref: href(index - 1), nextHref: href(index + 1) }}
        backHref={`/demo/${scanId}#findings`}
      />
    </>
  );
}
