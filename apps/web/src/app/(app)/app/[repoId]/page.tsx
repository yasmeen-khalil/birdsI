import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Check, PlaneTakeoff } from "lucide-react";
import { eventsAfter, latestDoneScan, toScan } from "@birdsi/db";
import { STEP_LABELS } from "@birdsi/engine";
import { CONFIDENCE_ORDER, SEVERITY_ORDER, type Confidence, type Finding, type Scan, type Severity } from "@birdsi/shared";
import { BirdsEyeMap, hitsFromFindings } from "@/components/BirdsEyeMap";
import { ConfidencePill } from "@/components/Confidence";
import { DependencyTable } from "@/components/DependencyTable";
import { FindingRow } from "@/components/FindingRow";
import { Frame } from "@/components/Frame";
import { LocalTime } from "@/components/LocalTime";
import { ScanAgainButton, ScanButtons, ScanControls } from "@/components/ScanActions";
import { SeverityMeter } from "@/components/Severity";
import { compareFindings, findingsHeadline, KIND_LABEL, KIND_LOWER, plural, repoName, shortDuration, shortSha } from "@/components/format";
import { icon14, icon20 } from "@/components/icon";
import { AlertList, PipelineStrip } from "@/components/ops/OpsParts";
import { VisionEditor } from "@/components/ops/VisionEditor";
import { ScanProgressCard } from "@/components/scan/ScanProgressCard";
import { inventoryOf, latestDone, recentScans, repoContext, runningOf } from "@/components/server/data";
import { loadInventory } from "@/lib/ops";
import { loadScan } from "@/lib/scans";

export const metadata: Metadata = { title: "Overview" };

function languagesLine(languages: Array<{ name: string; files: number }>): string {
  const names = languages.slice(0, 3).map((l) => l.name);
  if (names.length === 0) return "";
  if (names.length === 1) return `${names[0]}.`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}.`;
}

const SEV_BAR: Record<Severity, string | undefined> = { critical: "var(--critical)", high: "var(--high)", medium: undefined, low: "var(--text-3)" };

function scanResult(s: Scan): { text: string; tone?: string } {
  if (s.status === "queued" || s.status === "running") return { text: "Running", tone: "var(--accent)" };
  if (s.status === "failed") return { text: "Did not finish", tone: "var(--critical)" };
  if (s.status === "stopped") return { text: "Stopped", tone: "var(--critical)" };
  const n = s.summary ? Object.values(s.summary.bySeverity).reduce((a, b) => a + b, 0) : 0;
  if (s.kind === "audit" && s.audit) return { text: s.audit.verdict === "ready" ? "Ready to launch" : s.audit.verdict === "not_ready" ? "Not ready yet" : "No verdict" };
  return { text: plural(n, "finding") };
}

export default async function OverviewPage({ params }: { params: Promise<{ repoId: string }> }) {
  const { repoId } = await params;
  const { user, repo } = await repoContext(repoId);
  const [scans, latest, lastAuditRow] = await Promise.all([recentScans(repo.id), latestDone(repo.id), latestDoneScan(repo.id, "audit")]);
  const running = runningOf(scans);
  const lastAudit = lastAuditRow ? toScan(lastAuditRow) : null;
  const name = repoName(repo.full_name);
  const [result, inventory, runningEvents, ops] = await Promise.all([latest ? loadScan(latest.id, user) : null, latest ? inventoryOf(latest.id) : null, running ? eventsAfter(running.id, 0) : null, loadInventory(repo.id, user)]);
  const newest = scans[0] ?? null;
  const lastProblem = newest && (newest.status === "failed" || newest.status === "stopped") && (!latest || new Date(newest.createdAt) > new Date(latest.createdAt)) ? newest : null;

  const all: Finding[] = result ? [...result.findings].sort(compareFindings) : [];
  const open = all.filter((f) => f.status !== "dismissed");
  const fixable = open.filter((f) => f.actionKind === "fix").length;
  const bySev = Object.fromEntries(SEVERITY_ORDER.map((s) => [s, open.filter((f) => f.severity === s).length])) as Record<Severity, number>;
  const byConf = Object.fromEntries(CONFIDENCE_ORDER.map((c) => [c, open.filter((f) => f.confidence === c).length])) as Record<Confidence, number>;
  const byId = new Map(open.map((f) => [f.id, f]));
  const startIds = latest?.summary?.startWith ?? [];
  let startWith = startIds.map((id) => byId.get(id) ?? open.find((f) => f.key === id)).filter((f): f is Finding => Boolean(f));
  if (startWith.length === 0) startWith = open.filter((f) => f.severity === "critical" || f.severity === "high").slice(0, 3);
  const deps = result?.dependencies ?? [];
  const base = `/app/${repo.id}`;

  const local = repo.source === "local";
  const description = inventory
    ? `${languagesLine(inventory.languages)} ${plural(inventory.filesSeen, "file")} and ${plural(deps.length, "dependency", "dependencies")} on the ${latest?.branch ?? repo.default_branch} branch.${local ? " Uploaded from your terminal." : ""}`
    : local
      ? `Uploaded from your terminal, ${repo.default_branch} branch.`
      : `${repo.private ? "Private" : "Public"} repository on GitHub, ${repo.default_branch} branch.`;
  const syncRunning = ops.stages.some((s) => s.id === "ops" && s.freshness === "running");
  const needs = [ops.openQuestions > 0 ? plural(ops.openQuestions, "question") : null, ops.pendingActions > 0 ? plural(ops.pendingActions, "approval") : null].filter(Boolean).join(" and ");

  return (
    <main className="flex flex-col gap-[72px] px-16 pt-12 pb-16 max-[900px]:gap-12 max-[900px]:px-5 max-[900px]:pt-7 max-[900px]:pb-10">
      <section className="flex flex-col justify-between gap-5 min-[901px]:flex-row min-[901px]:items-end min-[901px]:gap-10">
        <div className="flex min-w-0 flex-col gap-2.5">
          <h1 className="t-h1 break-words">{name}</h1>
          <p className="t-body c2">{description}</p>
        </div>
        <ScanControls repoId={repo.id} runningKind={running?.kind ?? null} syncRunning={syncRunning} />
      </section>

      {needs && (
        <Link href={`${base}/agent`} className="panel flex items-center justify-between gap-4 max-[900px]:-mt-6 min-[901px]:-mt-10" style={{ padding: "14px 18px", textDecoration: "none", borderColor: "var(--line-strong)" }}>
          <span className="t-body">
            <span style={{ fontWeight: 600 }}>Needs you:</span> <span className="c2">{needs} waiting for your answer.</span>
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
          kind={running.kind}
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
            {lastProblem.status === "stopped" ? `The ${KIND_LOWER[lastProblem.kind]} was stopped` : `The ${KIND_LOWER[lastProblem.kind]} did not finish`}
          </h2>
          <p className="t-small c2">
            {lastProblem.status === "stopped" ? "It was stopped before it finished. " : `${lastProblem.error ?? "Something went wrong while it ran."} `}
            {latest ? "The results below are from the last scan that finished." : "Nothing was lost; start it again when you are ready."}
          </p>
          <p className="t-mono-s c3">Reference: scan {lastProblem.id.slice(0, 6)}</p>
          <div className="flex flex-wrap items-center justify-end gap-2.5">
            <Link className="btn btn-secondary btn-sm" href={`${base}/scans/${lastProblem.id}`}>
              What happened
            </Link>
            <ScanAgainButton repoId={repo.id} kind={lastProblem.kind} />
          </div>
        </section>
      )}

      {!latest && !running && (
        <section className="panel flex flex-col gap-3.5" style={{ padding: "22px 24px", maxWidth: 560 }} aria-labelledby="no-scans">
          <h2 id="no-scans" className="t-h2" style={{ fontSize: 23 }}>
            No scans of {name} yet
          </h2>
          <p className="t-small c2">Start with a full scan. It maps the code, checks current docs, audits the code and syncs the vendors it runs on, in that order. About 6 minutes. A quick check takes about a minute.</p>
          <ScanButtons repoId={repo.id} runningKind={null} layout="compact" />
        </section>
      )}

      {ops.alerts.length > 0 && (
        <section className="flex flex-col gap-4" aria-labelledby="alerts-title">
          <div className="flex flex-col gap-1.5">
            <h2 id="alerts-title" className="t-h2 max-[900px]:text-[24px]!">
              Alerts
            </h2>
            <p className="t-body c2">What birdsI noticed about the services this app runs on.</p>
          </div>
          <AlertList alerts={ops.alerts} limit={4} vendorsHref={`${base}/vendors`} />
        </section>
      )}

      {latest && result && (
        <section className="grid grid-cols-1 gap-y-10 min-[901px]:grid-cols-12 min-[901px]:gap-x-6">
          <div className="flex min-w-0 flex-col gap-3.5 min-[901px]:col-span-7">
            {open.length === 0 && <Check {...icon20} className="i i20" style={{ color: "var(--ok)" }} />}
            <h2 className="t-display max-[900px]:text-[30px]! max-[900px]:leading-[1.12]!" style={{ fontSize: 44 }}>
              {findingsHeadline(open.length, fixable)}
            </h2>
            <p className="t-body c2">
              From the {KIND_LOWER[latest.kind]} of {latest.branch ?? repo.default_branch}, finished <LocalTime iso={latest.finishedAt} />
              {shortSha(latest.commitSha) ? (
                <>
                  {" "}
                  on commit{" "}
                  <span className="t-mono" style={{ color: "var(--text)" }}>
                    {shortSha(latest.commitSha)}
                  </span>
                </>
              ) : null}
              .{all.length > open.length ? ` ${plural(all.length - open.length, "finding")} dismissed.` : ""}
            </p>
            {inventory && (
              <figure className="m-0 flex flex-col gap-[18px] min-[901px]:mt-9">
                <BirdsEyeMap folders={inventory.folders} hits={hitsFromFindings(open)} findingsHref={`${base}/findings`} label={`${name} seen from above, one square per file. Ringed files have findings.`} />
                <figcaption className="t-small c3">Each square is one file. Ringed files have findings; select one to see them.</figcaption>
              </figure>
            )}
          </div>
          <aside className="flex flex-col gap-9 min-[901px]:col-span-4 min-[901px]:col-start-9">
            <div className="grid grid-cols-2 gap-x-5 min-[901px]:grid-cols-1 min-[901px]:gap-y-9">
              <div>
                <h3 className="t-label c2" style={{ paddingBottom: 12 }}>
                  By severity
                </h3>
                {SEVERITY_ORDER.map((s, i) => (
                  <Link key={s} className="ledger max-[900px]:grid-cols-[minmax(0,1fr)_auto]!" href={`${base}/findings?sev=${s}`} style={i === 3 ? { borderBottom: "1px solid var(--line)" } : undefined}>
                    <SeverityMeter severity={s} />
                    <span className="n">{bySev[s]}</span>
                    <span className="b max-[900px]:hidden!">
                      <i style={{ width: `${open.length ? Math.round((bySev[s] / open.length) * 100) : 0}%`, ...(SEV_BAR[s] ? { background: SEV_BAR[s] } : {}) }} />
                    </span>
                  </Link>
                ))}
              </div>
              <div>
                <h3 className="t-label c2" style={{ paddingBottom: 12 }}>
                  By confidence
                </h3>
                {CONFIDENCE_ORDER.map((c, i) => (
                  <Link key={c} className="ledger max-[900px]:grid-cols-[minmax(0,1fr)_auto]!" href={`${base}/findings?conf=${c}`} style={i === 2 ? { borderBottom: "1px solid var(--line)" } : undefined}>
                    <ConfidencePill confidence={c} />
                    <span className="n">{byConf[c]}</span>
                    <span className="b max-[900px]:hidden!">
                      <i style={{ width: `${open.length ? Math.round((byConf[c] / open.length) * 100) : 0}%` }} />
                    </span>
                  </Link>
                ))}
              </div>
            </div>
            <Link className="btn btn-secondary self-start max-[900px]:self-stretch" href={`${base}/findings`}>
              See all {plural(open.length, "finding")}
            </Link>
          </aside>
        </section>
      )}

      {startWith.length > 0 && (
        <section className="flex flex-col" aria-labelledby="start-with">
          <div className="flex items-baseline justify-between gap-3" style={{ paddingBottom: 14 }}>
            <h2 id="start-with" className="t-h2 max-[900px]:text-[24px]!">
              Start with these
            </h2>
            <span className="t-small c3">The most serious first</span>
          </div>
          {startWith.map((f, i) => (
            <FindingRow key={f.id} finding={f} href={`${base}/findings/${f.id}`} last={i === startWith.length - 1} />
          ))}
        </section>
      )}

      <VisionEditor repoId={repo.id} initial={ops.vision.text} updatedAt={ops.vision.updatedAt} />

      {latest && (
        <section id="deps" className="flex flex-col gap-5" aria-labelledby="deps-title">
          <div className="flex flex-col gap-1.5">
            <h2 id="deps-title" className="t-h2 max-[900px]:text-[24px]!">
              Dependencies
            </h2>
            <p className="t-body c2">{deps.length === 0 ? "No package manifests were found in this repository." : `${plural(deps.length, "package")}. Each one is checked for known problems, and deep scans check it against its current docs.`}</p>
          </div>
          {deps.length > 0 && <DependencyTable dependencies={deps} limit={8} showAllHref={`${base}/dependencies`} />}
        </section>
      )}

      <section className="grid grid-cols-1 gap-y-12 min-[901px]:grid-cols-12 min-[901px]:gap-x-6">
        <div className="flex flex-col min-[901px]:col-span-7">
          <h2 className="t-h2 max-[900px]:text-[24px]!" style={{ paddingBottom: 14 }}>
            Recent scans
          </h2>
          {scans.length === 0 ? (
            <p className="t-small c3" style={{ padding: "13px 0", borderTop: "1px solid var(--line)" }}>
              No scans yet.
            </p>
          ) : (
            scans.map((s, i) => {
              const r = scanResult(s);
              return (
                <Link
                  key={s.id}
                  href={s.kind === "audit" && s.status === "done" ? `${base}/audit?scan=${s.id}` : `${base}/scans/${s.id}`}
                  className="t-small grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 min-[901px]:grid-cols-[130px_minmax(0,1fr)_90px_120px_80px]"
                  style={{ padding: "13px 0", minHeight: 44, borderTop: "1px solid var(--line)", ...(i === scans.length - 1 ? { borderBottom: "1px solid var(--line)" } : {}), textDecoration: "none", color: "var(--text)" }}
                >
                  <span style={{ fontWeight: 600 }}>{KIND_LABEL[s.kind]}</span>
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
        <Frame arm={26} bend={12} className="flex flex-col gap-3.5 px-[30px] py-7 min-[901px]:col-span-4 min-[901px]:col-start-9 max-[900px]:px-[22px] max-[900px]:py-6">
          <PlaneTakeoff {...icon20} className="i i20 c2" />
          <h2 className="t-h2 max-[900px]:text-[24px]!">Before you launch</h2>
          <p className="t-body c2">The pre-launch audit is the deepest check birdsI runs. It goes area by area, from sign-in to payments, and tells you plainly whether you are ready. About 25 minutes.</p>
          {lastAudit?.audit ? (
            <p className="t-small c3">
              Last audit <LocalTime iso={lastAudit.finishedAt} />: {lastAudit.audit.verdict === "ready" ? "ready to launch" : lastAudit.audit.verdict === "not_ready" ? "not ready yet" : "no verdict"}.
            </p>
          ) : (
            <p className="t-small c3">Not run on {name} yet.</p>
          )}
          <Link className="btn btn-secondary self-start" href={`${base}/audit`} style={{ marginTop: 6 }}>
            {running?.kind === "audit" ? "Watch the audit" : lastAudit ? "See the report" : "Set up the audit"}
          </Link>
        </Frame>
      </section>
    </main>
  );
}
