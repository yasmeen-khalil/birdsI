import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FindingDetail } from "@/components/FindingDetail";
import { orNotFound, requireId } from "@/components/guard";
import { compareFindings } from "@/components/format";
import { repoContext } from "@/components/server/data";
import { loadFinding, loadScan } from "@/lib/scans";

export const metadata: Metadata = { title: "Finding" };

export default async function FindingPage({ params, searchParams }: { params: Promise<{ repoId: string; findingId: string }>; searchParams: Promise<{ scan?: string }> }) {
  const p = await params;
  const sp = await searchParams;
  const { user, repo } = await repoContext(p.repoId);
  const findingId = requireId(p.findingId);
  const { finding } = await orNotFound(loadFinding(findingId, user));
  if (finding.repoId !== repo.id) notFound();
  const { scan, findings } = await loadScan(finding.scanId, user);

  const ordered = [...findings].filter((f) => f.status !== "dismissed" || f.id === finding.id).sort(compareFindings);
  const index = Math.max(0, ordered.findIndex((f) => f.id === finding.id));
  const suffix = sp.scan ? `?scan=${encodeURIComponent(sp.scan)}` : "";
  const href = (i: number) => (ordered[i] ? `/app/${repo.id}/findings/${ordered[i]!.id}${suffix}` : null);

  return (
    <FindingDetail
      finding={finding}
      scan={scan}
      repo={{ id: repo.id, fullName: repo.full_name, defaultBranch: repo.default_branch }}
      position={{ index, total: ordered.length, prevHref: href(index - 1), nextHref: href(index + 1) }}
      backHref={`/app/${repo.id}/findings${suffix}`}
    />
  );
}
