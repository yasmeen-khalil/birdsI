import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { eventsAfter } from "@birdsi/db";
import { STEP_LABELS } from "@birdsi/engine";
import type { Scan } from "@birdsi/shared";
import { LocalTime } from "@/components/LocalTime";
import { ScanAgainButton, ScanControls } from "@/components/ScanActions";
import { plural, repoName, scanName, shortDuration, shortSha } from "@/components/format";
import { icon14 } from "@/components/icon";
import { AppIcon } from "@/components/Logos";
import { CockpitSections } from "@/components/cockpit/Cockpit";
import { PipelineStrip } from "@/components/ops/OpsParts";
import { VisionEditor } from "@/components/ops/VisionEditor";
import { ScanProgressCard } from "@/components/scan/ScanProgressCard";
import { inventoryOf, latestDone, recentScans, repoContext, runningOf } from "@/components/server/data";
import { loadCockpit } from "@/lib/cockpit";
import { loadChecklist } from "@/lib/checklist";
import { loadInventory } from "@/lib/ops";
import { loadScan } from "@/lib/scans";

export const metadata: Metadata = { title: "Cockpit" };

function languagesLine(languages: Array<{ name: string; files: number }>): string {
  const names = languages.slice(0, 3).map((l) => l.name);
  if (names.length === 0) return "";
  if (names.length === 1) return `${names[0]}.`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}.`;
}


function scanResult(s: Scan): { text: string; tone?: string } {
  if (s.status === "queued" || s.status === "running") return { text: "Running", tone: "var(--accent)" };
  if (s.status === "failed") return { text: "Did not finish", tone: "var(--critical)" };
  if (s.status === "stopped") return { text: "Stopped", tone: "var(--critical)" };
  const n = s.summary ? Object.values(s.summary.bySeverity).reduce((a, b) => a + b, 0) : 0;
  return { text: plural(n, "finding") };
}

export default async function CockpitPage({ params }: { params: Promise<{ repoId: string }> }) {
  const { repoId } = await params;
  const { user, repo } = await repoContext(repoId);
  const [scans, latest] = await Promise.all([recentScans(repo.id), latestDone(repo.id)]);
  const running = runningOf(scans);
  const name = repoName(repo.full_name);
  const [result, inventory, runningEvents, ops, cockpit, checklist] = await Promise.all([latest ? loadScan(latest.id, user) : null, latest ? inventoryOf(latest.id) : null, running ? eventsAfter(running.id, 0) : null, loadInventory(repo.id, user), loadCockpit(repo.id, user), loadChecklist(repo.id, user)]);
  const title = cockpit.appName || name;
  const newest = scans[0] ?? null;
  const lastProblem = newest && (newest.status === "failed" || newest.status === "stopped") && (!latest || new Date(newest.createdAt) > new Date(latest.createdAt)) ? newest : null;

  const deps = result?.dependencies ?? [];
  const base = `/app/${repo.id}`;
  const readRunning = ops.stages.some((s) => s.id === "reads" && s.freshness === "running");

  const local = repo.source === "local";
  const description = inventory
    ? `${languagesLine(inventory.languages)} ${plural(inventory.filesSeen, "file")} and ${plural(deps.length, "dependency", "dependencies")} on the ${latest?.branch ?? repo.default_branch} branch.${local ? " Uploaded from your terminal." : ""}`
    : local
      ? `Uploaded from your terminal, ${repo.default_branch} branch.`
      : `${repo.private ? "Private" : "Public"} repository on GitHub, ${repo.default_branch} branch.`;
  const needs = [ops.openQuestions > 0 ? plural(ops.openQuestions, "question") : null, ops.pendingActions > 0 ? plural(ops.pendingActions, "approval") : null].filter(Boolean).join(" and ");

  return (
    <main className="flex flex-col gap-[72px] px-16 pt-12 pb-16 max-[900px]:gap-12 max-[900px]:px-5 max-[900px]:pt-7 max-[900px]:pb-10">
      {!checklist.complete ? (
        <section className="panel flex flex-wrap items-center justify-between gap-3" style={{ padding: "14px 20px", marginBottom: -40 }} aria-label="Set up">
          <span className="t-small c2">
            <span style={{ color: "var(--text)", fontWeight: 600 }}>
              Set up: {checklist.required.done} of {checklist.required.total} required steps done.
            </span>{" "}
            {(() => {
              const next = checklist.items.find((i) => i.required && i.status !== "done");
              return next ? `Next: ${next.title.toLowerCase()}.` : "";
            })()}{" "}
            birdsI builds the cockpit from what you connect, and says what each key lets it read before you make one.
          </span>
          <Link className="btn btn-secondary btn-sm" href={`${base}/setup`}>
            Open the checklist
            <ArrowRight {...icon14} />
          </Link>
        </section>
      ) : null}
      <section className="flex flex-col justify-between gap-5 min-[901px]:flex-row min-[901px]:items-end min-[901px]:gap-10">
        <div className="flex min-w-0 flex-col gap-2.5">
          <div className="flex items-center gap-3">
            <AppIcon name={title} base={cockpit.appIconBase} />
            <h1 className="t-h1 break-words">{title}</h1>
          </div>
          <p className="t-body c2">{description}</p>
        </div>
        <ScanControls repoId={repo.id} mapRunning={Boolean(running)} readRunning={readRunning} />
      </section>

      {needs && (
        <Link href={`${base}/agent`} className="panel flex items-center justify-between gap-4 max-[900px]:-mt-6 min-[901px]:-mt-10" style={{ padding: "14px 18px", textDecoration: "none", borderColor: "var(--line-strong)" }}>
          <span className="t-body">
            <span style={{ fontWeight: 600 }}>Needs you:</span> <span className="c2">{needs} waiting on you.</span>
          </span>
          <span className="t-small c2 inline-flex items-center gap-1.5">
            Open
            <ArrowRight {...icon14} />
          </span>
        </Link>
      )}

      <PipelineStrip stages={ops.stages} />

      {running && runningEvents && (
        <ScanProgressCard
          scanId={running.id}
          repoId={repo.id}
          initialStatus={running.status}
          initialEvents={runningEvents}
          initialCursor={runningEvents[runningEvents.length - 1]?.seq ?? 0}
          stepLabels={STEP_LABELS}
          hasEarlierResults={Boolean(latest)}
        />
      )}

      {lastProblem && !running && (
        <section className="panel flex flex-col gap-3.5" style={{ padding: "22px 24px" }} aria-labelledby="scan-problem">
          <h2 id="scan-problem" className="t-h2" style={{ fontSize: 23 }}>
            {lastProblem.status === "stopped" ? "The map was stopped" : "The map did not finish"}
          </h2>
          <p className="t-small c2">
            {lastProblem.status === "stopped" ? "It was stopped before it finished. " : `${lastProblem.error ?? "It stopped with an error before it finished."} `}
            {latest ? "The page shows the last map that finished." : "Nothing was lost. Start it again when you are ready."}
          </p>
          <p className="t-mono-s c3">Reference: map {lastProblem.id.slice(0, 6)}</p>
          <div className="flex flex-wrap items-center justify-end gap-2.5">
            <Link className="btn btn-secondary btn-sm" href={`${base}/scans/${lastProblem.id}`}>
              What happened
            </Link>
            <ScanAgainButton repoId={repo.id} />
          </div>
        </section>
      )}

      {!latest && !running && (
        <section className="panel flex flex-col gap-3.5" style={{ padding: "22px 24px", maxWidth: 560 }} aria-labelledby="no-scans">
          <h2 id="no-scans" className="t-h2" style={{ fontSize: 23 }}>
            {name} is not mapped yet
          </h2>
          <p className="t-small c2">The map reads every file, package and outside service the app runs on, in about a minute, with no model. Then birdsI reads the accounts you connect.</p>
          <div className="flex justify-end">
            <ScanAgainButton repoId={repo.id} label="Map the code" />
          </div>
        </section>
      )}

      <CockpitSections view={cockpit} repoId={repo.id} />

      {ops.watches.length > 0 && (
        <Link href={`${base}/vendors`} className="t-small c2 inline-flex items-center gap-1.5 self-start max-[900px]:-mt-4 min-[901px]:-mt-10" style={{ minHeight: 32 }}>
          Tracking {plural(ops.watches.length, "condition")} that could affect your services
          <ArrowRight {...icon14} />
        </Link>
      )}

      <VisionEditor repoId={repo.id} initial={ops.vision.text} updatedAt={ops.vision.updatedAt} />

      <section className="grid grid-cols-1 gap-y-12 min-[901px]:grid-cols-12 min-[901px]:gap-x-6">
        <div className="flex flex-col min-[901px]:col-span-7">
          <h2 className="t-h2 max-[900px]:text-[24px]!" style={{ paddingBottom: 14 }}>
            Recent maps
          </h2>
          {scans.length === 0 ? (
            <p className="t-small c3" style={{ padding: "13px 0", borderTop: "1px solid var(--line)" }}>
              No maps yet.
            </p>
          ) : (
            scans.map((s, i) => {
              const r = scanResult(s);
              return (
                <Link
                  key={s.id}
                  href={s.status === "done" ? `${base}/findings?scan=${s.id}` : `${base}/scans/${s.id}`}
                  className="t-small grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 min-[901px]:grid-cols-[130px_minmax(0,1fr)_90px_120px_80px]"
                  style={{ padding: "13px 0", minHeight: 44, borderTop: "1px solid var(--line)", ...(i === scans.length - 1 ? { borderBottom: "1px solid var(--line)" } : {}), textDecoration: "none", color: "var(--text)" }}
                >
                  <span style={{ fontWeight: 600 }}>{scanName(s.kind)}</span>
                  <span className="c2 max-[900px]:col-start-1 max-[900px]:row-start-2">
                    <LocalTime iso={s.startedAt ?? s.createdAt} style="list" />
                  </span>
                  <span className="c2 max-[900px]:hidden">{s.stats ? shortDuration(s.stats.durationMs) : ""}</span>
                  <span className="max-[900px]:row-span-2 max-[900px]:text-right" style={{ color: r.tone ?? "var(--text)" }}>
                    {r.text}
                  </span>
                  <span className="t-mono-s c3 max-[900px]:hidden">{shortSha(s.commitSha) ?? ""}</span>
                </Link>
              );
            })
          )}
        </div>

      </section>
    </main>
  );
}
