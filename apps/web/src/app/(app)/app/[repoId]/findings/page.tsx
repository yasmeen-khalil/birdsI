import Link from "next/link";
import type { ReactNode } from "react";
import type { Metadata } from "next";
import { Check, ChevronDown, X } from "lucide-react";
import { scanForViewer, toScan } from "@birdsi/db";
import { CONFIDENCE_ORDER, SEVERITY_ORDER, type ActionKind, type Confidence, type Finding, type Scan } from "@birdsi/shared";
import { ConfidenceGlyph, ConfidencePill } from "@/components/Confidence";
import { Dropdown } from "@/components/Dropdown";
import { FindingRow } from "@/components/FindingRow";
import { Frame } from "@/components/Frame";
import { LocalTime } from "@/components/LocalTime";
import { ScanButtons } from "@/components/ScanActions";
import { SeverityMeter } from "@/components/Severity";
import { orNotFound } from "@/components/guard";
import { compareFindings, CONFIDENCE_LABEL, KIND_LABEL, KIND_LOWER, plural, SEVERITY_LABEL, shortDuration, shortSha } from "@/components/format";
import { icon14, icon20 } from "@/components/icon";
import { latestDone, recentScans, repoContext, runningOf } from "@/components/server/data";
import { loadScan } from "@/lib/scans";

export const metadata: Metadata = { title: "Findings" };

type Search = { scan?: string; sev?: string; conf?: string; who?: string; dismissed?: string; file?: string; group?: string };
type Group = "severity" | "confidence" | "action";

const WHO_LABEL: Record<ActionKind, string> = { fix: "birdsI can fix", steps: "You need to do" };
const GROUP_LABEL: Record<Group, string> = { severity: "Severity", confidence: "Confidence", action: "Who acts" };

function pick<T extends string>(value: string | undefined, allowed: readonly T[]): T | null {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

export default async function FindingsPage({ params, searchParams }: { params: Promise<{ repoId: string }>; searchParams: Promise<Search> }) {
  const { repoId } = await params;
  const sp = await searchParams;
  const { user, repo } = await repoContext(repoId);
  const base = `/app/${repo.id}`;
  const [scans, latest] = await Promise.all([recentScans(repo.id), latestDone(repo.id)]);
  const running = runningOf(scans);

  let scan: Scan | null = latest;
  if (sp.scan && /^[0-9a-f-]{36}$/i.test(sp.scan)) {
    const chosen = scans.find((s) => s.id === sp.scan) ?? toScan(await orNotFound(scanForViewer(sp.scan, user.id)));
    if (chosen.repoId === repo.id && (chosen.status === "done" || chosen.status === "stopped")) scan = chosen;
  }

  if (!scan) {
    return (
      <main className="flex flex-col gap-8 px-16 pt-12 pb-16 max-[900px]:px-5 max-[900px]:pt-7">
        <h1 className="t-h1">Findings</h1>
        <section className="panel flex flex-col gap-3.5" style={{ padding: "22px 24px", maxWidth: 560 }}>
          <h2 className="t-h2" style={{ fontSize: 23 }}>
            {running ? "The first scan is running" : "No findings yet"}
          </h2>
          <p className="t-small c2">{running ? "Findings appear here as soon as it finishes." : "Run a scan and every finding shows up here, grouped by how serious it is."}</p>
          {running ? (
            <div className="flex justify-end">
              <Link className="btn btn-secondary btn-sm" href={`${base}/scans/${running.id}`}>
                Watch progress
              </Link>
            </div>
          ) : (
            <ScanButtons repoId={repo.id} runningKind={null} layout="compact" />
          )}
        </section>
      </main>
    );
  }

  const result = await loadScan(scan.id, user);
  const sev = pick(sp.sev, SEVERITY_ORDER);
  const conf = pick(sp.conf, CONFIDENCE_ORDER);
  const who = pick(sp.who, ["fix", "steps"] as const);
  const group: Group = pick(sp.group, ["severity", "confidence", "action"] as const) ?? "severity";
  const showDismissed = sp.dismissed === "1";
  const file = sp.file ?? null;

  const all = [...result.findings].sort(compareFindings);
  const open = all.filter((f) => f.status !== "dismissed");
  const dismissedCount = all.length - open.length;
  const scope = (showDismissed ? all : open).filter((f) => !file || f.location?.path === file);
  const shown = scope.filter((f) => (!sev || f.severity === sev) && (!conf || f.confidence === conf) && (!who || f.actionKind === who));

  const href = (patch: Partial<Record<keyof Search, string | null>>) => {
    const q = new URLSearchParams();
    const merged: Record<string, string | null | undefined> = { scan: sp.scan, sev, conf, who, dismissed: showDismissed ? "1" : null, file, group: group === "severity" ? null : group, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) q.set(k, v);
    const s = q.toString();
    return `${base}/findings${s ? `?${s}` : ""}`;
  };
  const detailHref = (f: Finding) => `${base}/findings/${f.id}${sp.scan ? `?scan=${sp.scan}` : ""}`;
  const pickable = scans.filter((s) => s.status === "done" || s.status === "stopped");

  const groups: Array<{ key: string; head: ReactNode; items: Finding[] }> =
    group === "severity"
      ? SEVERITY_ORDER.map((s) => ({ key: s, head: <SeverityMeter severity={s} />, items: shown.filter((f) => f.severity === s) }))
      : group === "confidence"
        ? CONFIDENCE_ORDER.map((c) => ({ key: c, head: <ConfidencePill confidence={c} />, items: shown.filter((f) => f.confidence === c) }))
        : (["fix", "steps"] as const).map((a) => ({ key: a, head: <span className="t-label">{a === "fix" ? "birdsI can fix this" : "You need to do this"}</span>, items: shown.filter((f) => f.actionKind === a) }));

  const filterWords = [sev ? SEVERITY_LABEL[sev] : null, conf ? CONFIDENCE_LABEL[conf] : null].filter(Boolean);
  const chipStyle = { minHeight: 32 };

  return (
    <main className="flex flex-col px-16 pt-12 pb-16 max-[900px]:px-5 max-[900px]:pt-7 max-[900px]:pb-10">
      <section className="flex flex-col justify-between gap-5 min-[901px]:flex-row min-[901px]:items-end min-[901px]:gap-10">
        <div className="flex flex-col gap-2.5">
          <h1 className="t-h1">{plural(open.length, "finding")}</h1>
          <p className="t-body c2">
            {KIND_LABEL[scan.kind]} of {scan.branch ?? repo.default_branch}, <LocalTime iso={scan.finishedAt ?? scan.createdAt} />.
            {scan.stats ? ` ${plural(scan.stats.filesSeen, "file")} and ${plural(scan.stats.dependencies, "dependency", "dependencies")} in ${shortDuration(scan.stats.durationMs)}` : ""}
            {shortSha(scan.commitSha) ? (
              <>
                , commit{" "}
                <span className="t-mono" style={{ color: "var(--text)" }}>
                  {shortSha(scan.commitSha)}
                </span>
              </>
            ) : null}
            .{scan.status === "stopped" ? " This scan was stopped early, so it may be missing findings." : ""}
          </p>
        </div>
        {pickable.length > 1 && (
          <div className="flex items-center gap-3">
            <span className="t-small c3">Scan</span>
            <Dropdown
              align="right"
              menuLabel="Choose a scan"
              buttonLabel="Choose a scan"
              button={
                <>
                  {KIND_LABEL[scan.kind]}, <LocalTime iso={scan.finishedAt ?? scan.createdAt} style="list" />
                  <ChevronDown {...icon14} className="i c3" />
                </>
              }
            >
              {pickable.map((s) => (
                <Link key={s.id} href={`${base}/findings?scan=${s.id}`} aria-current={s.id === scan.id ? "true" : undefined}>
                  <span className="flex flex-col">
                    <span>{KIND_LABEL[s.kind]}</span>
                    <span className="t-small c3">
                      <LocalTime iso={s.finishedAt ?? s.createdAt} style="list" />
                      {s.status === "stopped" ? ", stopped early" : ""}
                    </span>
                  </span>
                </Link>
              ))}
            </Dropdown>
          </div>
        )}
      </section>

      <section className="mt-9 flex flex-wrap items-center gap-x-9 gap-y-4" style={{ padding: "18px 0", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)" }} aria-label="Filters">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Severity">
          <span className="t-small c3" style={{ marginRight: 4 }}>
            Severity
          </span>
          <Link scroll={false} className={`chip${!sev ? " on" : ""}`} href={href({ sev: null })} aria-current={!sev ? "true" : undefined} style={chipStyle}>
            All
          </Link>
          {SEVERITY_ORDER.map((s) => (
            <Link key={s} scroll={false} className={`chip${sev === s ? " on" : ""}`} href={href({ sev: sev === s ? null : s })} aria-current={sev === s ? "true" : undefined} style={chipStyle}>
              <SeverityMeter severity={s} label={null} />
              {SEVERITY_LABEL[s]} <b>{scope.filter((f) => f.severity === s).length}</b>
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Confidence">
          <span className="t-small c3" style={{ marginRight: 4 }}>
            Confidence
          </span>
          <Link scroll={false} className={`chip${!conf ? " on" : ""}`} href={href({ conf: null })} aria-current={!conf ? "true" : undefined} style={chipStyle}>
            All
          </Link>
          {CONFIDENCE_ORDER.map((c: Confidence) => (
            <Link key={c} scroll={false} className={`chip${conf === c ? " on" : ""}`} href={href({ conf: conf === c ? null : c })} aria-current={conf === c ? "true" : undefined} style={{ ...chipStyle, ...(c === "judgment" ? { borderStyle: "dashed" } : {}) }}>
              <ConfidenceGlyph confidence={c} size={11} />
              {CONFIDENCE_LABEL[c]} <b>{scope.filter((f) => f.confidence === c).length}</b>
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Who acts">
          <span className="t-small c3" style={{ marginRight: 4 }}>
            Who acts
          </span>
          <Link scroll={false} className={`chip${!who ? " on" : ""}`} href={href({ who: null })} aria-current={!who ? "true" : undefined} style={chipStyle}>
            All
          </Link>
          {(["fix", "steps"] as const).map((a) => (
            <Link key={a} scroll={false} className={`chip${who === a ? " on" : ""}`} href={href({ who: who === a ? null : a })} aria-current={who === a ? "true" : undefined} style={chipStyle}>
              {WHO_LABEL[a]} <b>{scope.filter((f) => f.actionKind === a).length}</b>
            </Link>
          ))}
        </div>
        {(dismissedCount > 0 || file) && (
          <div className="flex flex-wrap items-center gap-2">
            {file && (
              <Link scroll={false} className="chip on" href={href({ file: null })} aria-label={`Showing ${file} only. Show all files`} style={chipStyle}>
                <span className="path" style={{ maxWidth: 220, color: "var(--text)" }}>
                  {file}
                </span>
                <X {...icon14} />
              </Link>
            )}
            {dismissedCount > 0 && (
              <Link scroll={false} className={`chip${showDismissed ? " on" : ""}`} href={href({ dismissed: showDismissed ? null : "1" })} aria-pressed={showDismissed} style={chipStyle}>
                {showDismissed && <Check {...icon14} />}
                Show dismissed <b>{dismissedCount}</b>
              </Link>
            )}
          </div>
        )}
        <div className="flex items-center gap-2 min-[901px]:ml-auto">
          <span className="t-small c3">Group by</span>
          <Dropdown
            align="right"
            menuLabel="Group findings by"
            buttonLabel={`Group by ${GROUP_LABEL[group]}`}
            button={
              <>
                {GROUP_LABEL[group]}
                <ChevronDown {...icon14} className="i c3" />
              </>
            }
          >
            {(Object.keys(GROUP_LABEL) as Group[]).map((g) => (
              <Link key={g} scroll={false} href={href({ group: g === "severity" ? null : g })} aria-current={group === g ? "true" : undefined}>
                {GROUP_LABEL[g]}
              </Link>
            ))}
          </Dropdown>
        </div>
      </section>

      {all.length === 0 ? (
        <section className="flex flex-col gap-3.5" style={{ padding: "40px 0" }}>
          <Frame arm={14} bend={6} className="flex items-center justify-center" style={{ width: 44, height: 44 }}>
            <Check {...icon20} />
          </Frame>
          <h2 className="t-h2" style={{ fontSize: 23 }}>
            Nothing needs you right now
          </h2>
          <p className="t-small c2">
            The {KIND_LOWER[scan.kind]} checked {scan.stats ? `${plural(scan.stats.filesSeen, "file")} and ${plural(scan.stats.dependencies, "dependency", "dependencies")}` : "your code"} and found no problems.
          </p>
          <div>
            <Link className="btn btn-secondary btn-sm" href={`${base}/audit`}>
              Run the pre-launch audit
            </Link>
          </div>
        </section>
      ) : shown.length === 0 ? (
        <section className="flex flex-col gap-3.5" style={{ padding: "40px 0", maxWidth: 560 }}>
          <h2 className="t-h2" style={{ fontSize: 23 }}>
            {filterWords.length > 0 || who ? `No ${[...filterWords, who ? WHO_LABEL[who].toLowerCase() : null].filter(Boolean).join(", ")} findings${file ? ` in ${file}` : ""}` : file ? `No open findings in ${file}` : "No open findings"}
          </h2>
          <p className="t-small c2">Your filters hide all {plural(scope.length, "finding")}.</p>
          <div>
            <Link className="btn btn-secondary btn-sm" href={`${base}/findings${sp.scan ? `?scan=${sp.scan}` : ""}`}>
              Clear filters
            </Link>
          </div>
        </section>
      ) : (
        <section className="flex flex-col" aria-label="Findings">
          {groups
            .filter((g) => g.items.length > 0)
            .map((g, gi, arr) => (
              <div key={g.key} role="group" aria-label={`${g.key}, ${g.items.length}`}>
                <div className="ghead">
                  {g.head}
                  <span className="t-small c3">{g.items.length}</span>
                </div>
                {g.items.map((f, i) => (
                  <FindingRow key={f.id} finding={f} href={detailHref(f)} last={gi === arr.length - 1 && i === g.items.length - 1} />
                ))}
              </div>
            ))}
        </section>
      )}
      <p className="t-small c3" style={{ marginTop: 24 }}>
        Judgment findings are birdsI’s reading of your code. Read the evidence before you act on them.
      </p>
    </main>
  );
}

