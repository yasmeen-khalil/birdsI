import Link from "next/link";
import type { Metadata } from "next";
import { Check, ChevronRight, CircleAlert } from "lucide-react";
import { eventsAfter, scanForViewer, toScan } from "@birdsi/db";
import { AREA_LABELS, STEP_LABELS } from "@birdsi/engine";
import { AUDIT_AREAS, type AuditArea, type AuditReport, type Finding, type Scan } from "@birdsi/shared";
import { AuditStartForm, PrintButton } from "@/components/AuditStartForm";
import { FindingRow } from "@/components/FindingRow";
import { Frame } from "@/components/Frame";
import { LocalTime } from "@/components/LocalTime";
import { orNotFound } from "@/components/guard";
import { compareFindings, CONFIDENCE_LABEL, KIND_SECONDS, plural, repoName, shortDuration, shortSha } from "@/components/format";
import { icon } from "@/components/icon";
import { LiveScan } from "@/components/scan/LiveScan";
import { latestDone, recentScans, repoContext } from "@/components/server/data";
import { loadScan } from "@/lib/scans";

export const metadata: Metadata = { title: "Pre-launch audit" };

/** Short plain lines for the entry checklist; titles come from the engine. */
const AREA_HINTS: Record<AuditArea, string> = {
  auth: "Pages and data that need sign-in actually require it",
  secrets: "No key or password in the code, its history or the browser",
  data: "Each person sees only their own records, and data can be deleted",
  dependencies: "No published vulnerabilities, nothing abandoned",
  errors: "Payments, uploads and emails fail safely and tell the user",
  config: "Production settings are safe and every setting your code needs exists",
  legal: "A privacy policy and terms that match what the code does",
  tests: "Something catches a broken deploy before your users do",
  operations: "The services it runs on are known, on plans that will not pause, and nothing is near a limit",
};

function areaTitles(): Record<string, string> {
  return Object.fromEntries(AUDIT_AREAS.map((a) => [a, AREA_LABELS[a].title]));
}

function Verdict({ verdict }: { verdict: "pass" | "attention" | "blocker" }) {
  if (verdict === "blocker")
    return (
      <span className="inline-flex items-center gap-2" style={{ font: "600 13px/1 var(--sans)", color: "var(--critical)" }}>
        <CircleAlert {...icon} />
        Blocks launch
      </span>
    );
  if (verdict === "attention")
    return (
      <span className="inline-flex items-center gap-2" style={{ font: "600 13px/1 var(--sans)", color: "var(--high)" }}>
        <CircleAlert {...icon} />
        Fix before launch
      </span>
    );
  return (
    <span className="c2 inline-flex items-center gap-2" style={{ font: "600 13px/1 var(--sans)" }}>
      <Check {...icon} />
      Cleared
    </span>
  );
}

function ReportSection({ id, title, lines, rows, base }: { id: string; title: string; lines: string[]; rows: Finding[]; base: string }) {
  return (
    lines.length === 0 && rows.length === 0 ? null : (
      <section id={id} className="flex flex-col">
        <div className="flex flex-wrap items-baseline justify-between gap-3" style={{ paddingBottom: 14 }}>
          <h2 className="t-h2 max-[900px]:text-[24px]!">{title}</h2>
          {rows.length > 0 && <span className="t-small c3">{plural(rows.length, "finding")}</span>}
        </div>
        {lines.length > 0 && (
          <ul className="t-body flex flex-col gap-2" style={{ margin: "0 0 16px", paddingLeft: 20 }}>
            {lines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        )}
        {rows.map((f, i) => (
          <FindingRow key={f.id} finding={f} href={`${base}/findings/${f.id}`} last={i === rows.length - 1} />
        ))}
      </section>
    )
  );
}

function Report({ scan, report, findings, base, name }: { scan: Scan; report: AuditReport; findings: Finding[]; base: string; name: string }) {
  const byId = new Map(findings.map((f) => [f.id, f]));
  const areaFindings = (verdict: "blocker" | "attention") =>
    [...new Set(report.areas.filter((a) => a.verdict === verdict).flatMap((a) => a.findingIds))]
      .map((id) => byId.get(id) ?? findings.find((f) => f.key === id))
      .filter((f): f is Finding => Boolean(f))
      .sort(compareFindings);
  const blockerFindings = areaFindings("blocker");
  const attentionFindings = areaFindings("attention").filter((f) => !blockerFindings.includes(f));
  const cleared = report.areas.filter((a) => a.verdict === "pass").length;
  const cited = [...blockerFindings, ...attentionFindings];
  const confCounts = (["proven", "doc_verified", "judgment"] as const).map((c) => [c, cited.filter((f) => f.confidence === c).length] as const).filter(([, n]) => n > 0);
  const order = { blocker: 0, attention: 1, pass: 2 } as const;
  const areas = [...report.areas].sort((a, b) => order[a.verdict] - order[b.verdict]);
  const firstBlocker = blockerFindings[0] ?? attentionFindings[0] ?? null;
  const verdictText = report.verdict === "ready" ? "Ready to launch." : report.verdict === "not_ready" ? "Not ready to launch yet." : "No verdict this time.";

  return (
    <main className="flex flex-col gap-16 px-16 pt-12 pb-16 max-[900px]:gap-12 max-[900px]:px-5 max-[900px]:pt-7">
      <p className="t-small c3" style={{ marginBottom: -40 }}>
        Pre-launch audit of {scan.branch ?? "the default branch"}
        {shortSha(scan.commitSha) ? (
          <>
            {" "}
            at <span className="t-mono-s">{shortSha(scan.commitSha)}</span>
          </>
        ) : null}
        . Finished <LocalTime iso={scan.finishedAt} />
        {scan.stats ? `, took ${shortDuration(scan.stats.durationMs)}` : ""}.
      </p>
      <Frame as="section" arm={40} bend={29} bracket="var(--text-2)" className="grid grid-cols-1 gap-y-8 px-16 py-14 max-[900px]:px-6 max-[900px]:py-8 max-[900px]:[--arm:24px]! max-[900px]:[--bend:17px]! min-[901px]:grid-cols-12 min-[901px]:items-end min-[901px]:gap-x-6" aria-labelledby="verdict">
        <div className="flex flex-col gap-5 min-[901px]:col-span-7">
          <h1 id="verdict" className="t-hero max-[900px]:text-[38px]!" style={{ fontSize: 64 }}>
            {verdictText}
          </h1>
          <p className="t-body-l c2">{report.headline}</p>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-7 min-[901px]:col-span-4 min-[901px]:col-start-9">
          {[
            [report.blockers.length, "Block launch", "var(--critical)"],
            [report.fixBeforeLaunch.length, "Fix before launch", "var(--high)"],
            [report.canWait.length, "Can wait", undefined],
          ].map(([n, label, color]) => (
            <div key={label as string} className="flex flex-col gap-1">
              <span style={{ fontFamily: "var(--serif)", fontSize: 40, fontWeight: 300, lineHeight: 1, color: color as string | undefined }}>{n}</span>
              <span className="t-small c2">{label}</span>
            </div>
          ))}
          <div className="flex flex-col gap-1">
            <span style={{ fontFamily: "var(--serif)", fontSize: 40, fontWeight: 300, lineHeight: 1 }}>
              {cleared}
              <span style={{ fontSize: 22, color: "var(--text-3)" }}> of {report.areas.length}</span>
            </span>
            <span className="t-small c2">Areas cleared</span>
          </div>
        </div>
      </Frame>

      <section className="flex flex-col" aria-labelledby="areas">
        <div className="flex flex-wrap items-baseline justify-between gap-3" style={{ paddingBottom: 14 }}>
          <h2 id="areas" className="t-h2 max-[900px]:text-[24px]!">
            Area by area
          </h2>
          {confCounts.length > 0 && <span className="t-small c3">Built on {confCounts.map(([c, n]) => `${n} ${CONFIDENCE_LABEL[c]}`).join(", ")} {cited.length === 1 ? "finding" : "findings"}</span>}
        </div>
        {areas.map((a, i) => {
          const first = a.findingIds.map((id) => byId.get(id) ?? findings.find((f) => f.key === id)).find(Boolean);
          const inner = (
            <>
              <span className="t-body" style={{ fontWeight: 600 }}>
                {AREA_LABELS[a.area]?.title ?? a.area}
              </span>
              <Verdict verdict={a.verdict} />
              <span className={`t-small ${a.verdict === "pass" ? "c3" : "c2"} max-[900px]:col-span-2`}>{a.note}</span>
              {first ? <ChevronRight {...icon} className="i c3 max-[900px]:hidden" /> : <span />}
            </>
          );
          const cls = "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-2 min-[901px]:grid-cols-[260px_200px_minmax(0,1fr)_16px]";
          const style = { padding: "15px 0", borderTop: "1px solid var(--line)", ...(i === areas.length - 1 ? { borderBottom: "1px solid var(--line)" } : {}), textDecoration: "none", color: "var(--text)" };
          return first ? (
            <Link key={a.area} className={cls} style={style} href={`${base}/findings/${first.id}`}>
              {inner}
            </Link>
          ) : (
            <div key={a.area} className={cls} style={style}>
              {inner}
            </div>
          );
        })}
      </section>

      <ReportSection id="blockers" title="Fix these before anything else" lines={report.blockers} rows={blockerFindings} base={base} />
      <ReportSection id="before" title="Fix before launch" lines={report.fixBeforeLaunch} rows={attentionFindings} base={base} />

      {report.canWait.length > 0 && (
        <details className="flex flex-col" style={{ borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)" }}>
          <summary className="flex cursor-pointer items-center justify-between gap-3" style={{ padding: "20px 0", listStyle: "none" }}>
            <span className="t-body c2">{plural(report.canWait.length, "more thing")} can wait until after launch</span>
            <span className="btn btn-quiet btn-sm">Show {report.canWait.length}</span>
          </summary>
          <ul className="t-body c2 flex flex-col gap-2" style={{ margin: "0 0 20px", paddingLeft: 20 }}>
            {report.canWait.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </details>
      )}

      <section className="no-print flex flex-col-reverse gap-3 min-[901px]:flex-row min-[901px]:items-center min-[901px]:justify-between">
        <PrintButton />
        <span className="flex flex-col gap-3 min-[901px]:flex-row">
          <Link className="btn btn-secondary" href={`${base}/audit?new=1`}>
            Audit again
          </Link>
          {firstBlocker && (
            <Link className="btn btn-primary" href={`${base}/findings/${firstBlocker.id}`}>
              Fix the first blocker
            </Link>
          )}
        </span>
      </section>
      <span className="sr-only">Report for {name}</span>
    </main>
  );
}

export default async function AuditPage({ params, searchParams }: { params: Promise<{ repoId: string }>; searchParams: Promise<{ scan?: string; new?: string }> }) {
  const { repoId } = await params;
  const sp = await searchParams;
  const { user, repo } = await repoContext(repoId);
  const base = `/app/${repo.id}`;
  const name = repoName(repo.full_name);
  const [scans, latest] = await Promise.all([recentScans(repo.id), latestDone(repo.id)]);
  const running = scans.find((s) => s.status === "queued" || s.status === "running") ?? null;

  let audit: Scan | null = scans.find((s) => s.kind === "audit") ?? null;
  if (sp.scan && /^[0-9a-f-]{36}$/i.test(sp.scan)) {
    const chosen = toScan(await orNotFound(scanForViewer(sp.scan, user.id)));
    if (chosen.repoId === repo.id && chosen.kind === "audit") audit = chosen;
  }

  if (audit && (audit.status === "queued" || audit.status === "running")) {
    const events = await eventsAfter(audit.id, 0);
    return (
      <main className="px-16 pt-12 pb-10 max-[900px]:px-5 max-[900px]:pt-7">
        <LiveScan
          scanId={audit.id}
          kind="audit"
          initialStatus={audit.status}
          initialEvents={events}
          initialCursor={events[events.length - 1]?.seq ?? 0}
          stepLabels={STEP_LABELS}
          heading={`Auditing ${name}`}
          intro={`Pre-launch audit of ${audit.branch ?? repo.default_branch}. Up to 600 files are read first, then each launch area is judged.`}
          mapTitle={`${name} from above`}
          mode="app"
          repoId={repo.id}
          expectedSeconds={KIND_SECONDS.audit}
          scanError={audit.error}
          leaveNote="Safe to close this page"
          areaTitles={areaTitles()}
        />
      </main>
    );
  }

  if (audit && audit.status === "done" && audit.audit && sp.new !== "1") {
    const { findings } = await loadScan(audit.id, user);
    return <Report scan={audit} report={audit.audit} findings={findings} base={base} name={name} />;
  }

  const problem = audit && (audit.status === "failed" || audit.status === "stopped") && sp.new !== "1" ? audit : null;
  const busy = running !== null;

  return (
    <main className="flex flex-col gap-10 px-16 pt-16 pb-12 max-[900px]:px-5 max-[900px]:pt-7">
      {problem && (
        <section className="panel flex flex-col gap-3.5" style={{ padding: "22px 24px", maxWidth: 640 }} role="status">
          <h2 className="t-h2" style={{ fontSize: 23 }}>
            {problem.status === "stopped" ? "The last audit was stopped" : "The last audit did not finish"}
          </h2>
          <p className="t-small c2">
            {problem.status === "stopped" ? "It was stopped before every area was judged." : (problem.error ?? "It stopped with an error before it finished.")} Start it again below. It takes 20 to 40 minutes.
          </p>
          <p className="t-mono-s c3">Reference: scan {problem.id.slice(0, 6)}</p>
        </section>
      )}
      {!audit && !problem && sp.new !== "1" && (
        <p className="t-small c3" role="status">
          No audit of {name} yet. Run it once before real people use your app, and again after big changes.
        </p>
      )}
      <AuditStartForm
        repoId={repo.id}
        disabled={busy}
        intro={
          <>
            <h1 className="t-display">Pre-launch audit</h1>
            <p className="t-body-l c2" style={{ maxWidth: 560 }}>
              The deepest check birdsI runs. It reads up to 600 files with its most careful model, judges each area a real launch depends on, and ends with a plain answer: ready, or not yet and why.
            </p>
            <dl className="t-body grid grid-cols-[120px_minmax(0,1fr)] gap-y-2.5" style={{ margin: "8px 0 0", maxWidth: 560 }}>
              <dt className="c3">Takes</dt>
              <dd style={{ margin: 0 }}>20 to 40 minutes. You can close the page.</dd>
              <dt className="c3">Covers</dt>
              <dd style={{ margin: 0 }}>{latest?.stats ? `${AUDIT_AREAS.length} areas, ${plural(latest.stats.filesSeen, "file")}, ${plural(latest.stats.dependencies, "dependency", "dependencies")}` : `${AUDIT_AREAS.length} areas, up to 600 files and every dependency`}</dd>
              <dt className="c3">When done</dt>
              <dd style={{ margin: 0 }}>The report appears on this page</dd>
            </dl>
            {busy && (
              <p className="t-small" style={{ color: "var(--high)" }}>
                A {running?.kind === "audit" ? "pre-launch audit" : "scan"} of {name} is running. You can start the audit when it finishes.{" "}
                <Link href={`${base}/scans/${running!.id}`} style={{ color: "var(--text)" }}>
                  Watch progress
                </Link>
              </p>
            )}
          </>
        }
        checklist={
          <Frame arm={24} bend={17} className="flex flex-col" style={{ padding: "28px 30px 30px" }}>
            <h2 className="t-h3" style={{ paddingBottom: 14 }}>
              What it checks
            </h2>
            {AUDIT_AREAS.map((a, i) => (
              <div key={a} className="grid grid-cols-[28px_minmax(0,1fr)] gap-x-2.5" style={{ padding: "14px 0", borderTop: "1px solid var(--line)", ...(i === AUDIT_AREAS.length - 1 ? { borderBottom: "1px solid var(--line)" } : {}) }}>
                <span aria-hidden="true" style={{ width: 14, height: 14, border: "1.5px solid var(--edge)", borderRadius: 3, marginTop: 4 }} />
                <span className="flex flex-col gap-0.5">
                  <span className="t-body" style={{ fontWeight: 600 }}>
                    {AREA_LABELS[a].title}
                  </span>
                  <span className="t-small c2">{AREA_HINTS[a]}</span>
                </span>
              </div>
            ))}
          </Frame>
        }
      />
    </main>
  );
}
