import Link from "next/link";
import type { Metadata } from "next";
import { dependenciesForScan } from "@birdsi/db";
import { DependencyTable } from "@/components/DependencyTable";
import { LocalTime } from "@/components/LocalTime";
import { ScanButtons } from "@/components/ScanActions";
import { KIND_LOWER, plural, repoName } from "@/components/format";
import { latestDone, recentScans, repoContext, runningOf } from "@/components/server/data";

export const metadata: Metadata = { title: "Dependencies" };

export default async function DependenciesPage({ params }: { params: Promise<{ repoId: string }> }) {
  const { repoId } = await params;
  const { repo } = await repoContext(repoId);
  const [latest, scans] = await Promise.all([latestDone(repo.id), recentScans(repo.id)]);
  const running = runningOf(scans);
  const deps = latest ? await dependenciesForScan(latest.id) : [];
  const vulnerable = deps.filter((d) => d.vulnerabilities.length > 0).length;

  return (
    <main className="flex flex-col gap-8 px-16 pt-12 pb-16 max-[900px]:px-5 max-[900px]:pt-7 max-[900px]:pb-10">
      <div className="flex flex-col gap-2.5">
        <h1 className="t-h1">Dependencies</h1>
        {latest ? (
          <p className="t-body c2">
            {plural(deps.length, "package")} in {repoName(repo.full_name)}
            {vulnerable > 0 ? `, ${vulnerable} with known problems` : ""}. From the {KIND_LOWER[latest.kind]} <LocalTime iso={latest.finishedAt} />. Each full scan checks them against their current docs.
          </p>
        ) : (
          <p className="t-body c2">Nothing has been scanned yet, so birdsI has not listed the packages this repository uses.</p>
        )}
      </div>
      {latest ? (
        deps.length > 0 ? (
          <DependencyTable dependencies={deps} />
        ) : (
          <p className="t-body c2" style={{ padding: "16px 0", borderTop: "1px solid var(--line)" }}>
            No package manifests were found. birdsI reads package.json, requirements files, go.mod, Cargo.toml and similar files to list dependencies.
          </p>
        )
      ) : running ? (
        <div className="panel flex flex-col gap-3" style={{ padding: "22px 24px", maxWidth: 560 }}>
          <p className="t-body">The first scan is running. Packages appear here when it finishes.</p>
          <div className="flex justify-end">
            <Link className="btn btn-secondary btn-sm" href={`/app/${repo.id}/scans/${running.id}`}>
              Watch progress
            </Link>
          </div>
        </div>
      ) : (
        <div className="panel flex flex-col gap-3" style={{ padding: "22px 24px", maxWidth: 560 }}>
          <p className="t-small c2">A quick check lists every package and checks it for published vulnerabilities in about two minutes.</p>
          <ScanButtons repoId={repo.id} runningKind={null} layout="compact" />
        </div>
      )}
    </main>
  );
}
