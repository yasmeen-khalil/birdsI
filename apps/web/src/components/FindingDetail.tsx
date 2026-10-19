import Link from "next/link";
import { ChevronLeft, ChevronRight, ExternalLink, X } from "lucide-react";
import type { Finding, Scan } from "@birdsi/shared";
import { ActionKind } from "./ActionKind";
import { CodeExcerpt } from "./CodeExcerpt";
import { ConfidencePill } from "./Confidence";
import { CheckAgainButton, DismissControl, StepsChecklist, StepsProgress } from "./FindingActions";
import { Frame } from "./Frame";
import { LocalTime } from "./LocalTime";
import { SeverityMeter } from "./Severity";
import { CONFIDENCE_MEANING, locationText, plural, safeUrl, scanName } from "./format";
import { icon, icon14 } from "./icon";

export interface FindingPosition {
  index: number;
  total: number;
  prevHref: string | null;
  nextHref: string | null;
}

const ACTION_BAR =
  "flex items-center justify-between gap-3 max-[900px]:fixed max-[900px]:inset-x-0 max-[900px]:bottom-0 max-[900px]:z-30 max-[900px]:border-t max-[900px]:border-[var(--line-strong)] max-[900px]:bg-[var(--surface)] max-[900px]:px-5 max-[900px]:pt-3.5 max-[900px]:pb-[calc(18px+env(safe-area-inset-bottom,0px))]";

export function FindingDetail({
  finding,
  scan,
  repo,
  position,
  backHref,
}: {
  finding: Finding;
  scan: Scan;
  repo: { id: string; fullName: string; defaultBranch: string };
  position: FindingPosition;
  backHref: string;
}) {
  const doc = finding.evidence.doc;
  const docUrl = safeUrl(doc?.url);
  const loc = finding.location;
  const dismissed = finding.status === "dismissed";
  const followUp = finding.fixPlan?.followUp ?? [];

  return (
    <>
      <div className="flex items-center justify-between gap-3 px-16 max-[900px]:px-2 max-[900px]:pl-5" style={{ minHeight: 52, borderBottom: "1px solid var(--line)" }}>
        <span className="t-small c3">
          Finding {position.index + 1} of {position.total}
          <span className="max-[900px]:hidden">, sorted by severity</span>
        </span>
        <span className="inline-flex items-center gap-1">
          {position.prevHref ? (
            <Link className="btn btn-quiet btn-sm max-[900px]:hidden!" href={position.prevHref} aria-label="Previous finding">
              <ChevronLeft {...icon} />
            </Link>
          ) : (
            <button type="button" className="btn btn-quiet btn-sm max-[900px]:hidden!" aria-label="Previous finding" disabled>
              <ChevronLeft {...icon} />
            </button>
          )}
          {position.nextHref ? (
            <Link className="btn btn-quiet btn-sm max-[900px]:h-11! max-[900px]:w-11! max-[900px]:p-0!" href={position.nextHref} aria-label="Next finding">
              <span className="max-[900px]:hidden">Next</span>
              <ChevronRight {...icon} />
            </Link>
          ) : (
            <button type="button" className="btn btn-quiet btn-sm max-[900px]:hidden!" disabled>
              <span>Next</span>
              <ChevronRight {...icon} />
            </button>
          )}
          <span className="max-[900px]:hidden" style={{ width: 1, height: 20, background: "var(--line-strong)", margin: "0 10px" }} aria-hidden="true" />
          <Link className="btn btn-secondary btn-sm max-[900px]:hidden!" href={backHref}>
            <X {...icon} />
            Back to findings
          </Link>
          <Link className="btn btn-quiet min-[901px]:hidden!" href={backHref} aria-label="Back to findings" style={{ width: 44, height: 44, padding: 0 }}>
            <X {...icon} />
          </Link>
        </span>
      </div>

      <main className="grid grid-cols-1 items-start gap-y-9 px-16 pt-12 pb-16 max-[900px]:px-5 max-[900px]:pt-7 max-[900px]:pb-36 min-[901px]:grid-cols-12 min-[901px]:gap-x-6">
        <article className="flex min-w-0 flex-col gap-10 min-[901px]:col-span-8 min-[901px]:pr-6">
          <header className="flex flex-col gap-[18px]">
            <div className="flex flex-wrap items-center gap-4">
              <SeverityMeter severity={finding.severity} />
              <ConfidencePill confidence={finding.confidence} />
              <ActionKind kind={finding.actionKind} className="max-[900px]:hidden!" />
              {dismissed && <span className="tag">Dismissed</span>}
              {finding.status === "pr_open" && <span className="tag">Pull request open</span>}
              {finding.status === "fixed" && <span className="tag ok">Fixed</span>}
            </div>
            <h1 className="t-h1">{finding.title}</h1>
            {loc && (
              <p className="path" style={{ fontSize: 13, whiteSpace: "normal" }}>
                {locationText(loc)}
              </p>
            )}
            <span className="min-[901px]:hidden">
              <ActionKind kind={finding.actionKind} />
            </span>
          </header>

          <section className="flex flex-col gap-3" style={{ maxWidth: 700 }}>
            <h2 className="t-h3">What birdsI found</h2>
            <p className="t-body-l c2 max-[900px]:text-[15px]!">{finding.explanation}</p>
            {finding.whyItMatters && (
              <>
                <h2 className="t-h3" style={{ marginTop: 12 }}>
                  Why it matters
                </h2>
                <p className="t-body-l c2 max-[900px]:text-[15px]!">{finding.whyItMatters}</p>
              </>
            )}
          </section>

          {(finding.evidence.excerpt || doc) && (
            <section className="flex flex-col gap-3.5">
              <h2 className="t-h3">Evidence</h2>
              {finding.evidence.excerpt && (
                <Frame arm={16} bend={12} bracket="var(--text-2)" style={{ padding: 10 }}>
                  <CodeExcerpt code={finding.evidence.excerpt} startLine={loc?.lineStart ?? 1} highlightFrom={loc?.lineStart} highlightTo={loc?.lineEnd ?? loc?.lineStart} path={loc?.path ?? null} note={finding.category === "security" && finding.confidence === "proven" ? "Secrets are hidden here." : loc?.lineStart ? `Line ${loc.lineStart}` : undefined} />
                </Frame>
              )}
              {doc && doc.excerpt && (
                <blockquote className="flex flex-col gap-2" style={{ margin: "4px 0 0", padding: "4px 0 4px 20px", borderLeft: "1px solid var(--line-strong)" }}>
                  <p className="t-body" style={{ fontFamily: "var(--serif)", fontSize: 19, lineHeight: 1.5, fontStyle: "italic" }}>
                    {doc.excerpt}
                  </p>
                  <footer className="t-small c3">
                    From{" "}
                    {docUrl ? (
                      <a href={docUrl} target="_blank" rel="noreferrer" style={{ color: "var(--text-2)" }}>
                        {doc.title}
                      </a>
                    ) : (
                      doc.title
                    )}
                    {doc.publishedAt ? (
                      <>
                        , published <LocalTime iso={doc.publishedAt} style="date" />
                      </>
                    ) : null}
                    .
                  </footer>
                </blockquote>
              )}
            </section>
          )}

          {finding.actionKind === "fix" && (
            <section className="flex flex-col gap-3.5">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h2 className="t-h3">The change that fixes it</h2>
                {finding.fixPlan && finding.fixPlan.paths.length > 0 && <span className="t-small c3">{plural(finding.fixPlan.paths.length, "file")}</span>}
              </div>
              {finding.fixPlan ? (
                <>
                  <p className="t-body c2">{finding.fixPlan.summary}</p>
                  {finding.fixPlan.paths.length > 0 && (
                    <div className="t-small flex flex-col" style={{ borderTop: "1px solid var(--line)" }}>
                      {finding.fixPlan.paths.map((p) => (
                        <div key={p} className="flex justify-between gap-3" style={{ padding: "12px 0", borderBottom: "1px solid var(--line)" }}>
                          <span className="path">{p}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <p className="t-body c2">A change in the code resolves it. birdsI does not write code: your coding agent reads this finding with birdsi_finding and makes the change in your session.</p>
              )}
            </section>
          )}

          {finding.actionKind === "steps" && (
            <section className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-baseline justify-between gap-3" style={{ paddingBottom: 10 }}>
                <h2 className="t-h2">What to do</h2>
                {finding.steps.length > 0 && <span className="t-small c3">{plural(finding.steps.length, "step")}</span>}
              </div>
              {finding.steps.length > 0 ? <StepsChecklist findingId={finding.id} steps={finding.steps} /> : <p className="t-body c2">birdsI has no steps for this one. The evidence above says what was found and where.</p>}
            </section>
          )}
        </article>

        <aside className="flex flex-col gap-5 min-[901px]:col-span-4">
          <section className="panel flex flex-col gap-3.5" style={{ padding: "22px 24px" }}>
            <div className="flex items-center justify-between gap-3">
              <ConfidencePill confidence={finding.confidence} />
              <Link className="t-small c3" href="/#how">
                What this means
              </Link>
            </div>
            <p className="t-body">{CONFIDENCE_MEANING[finding.confidence]}</p>
            {(finding.evidence.rule || doc || finding.evidence.advisories.length > 0) && (
              <dl className="t-small grid grid-cols-[76px_minmax(0,1fr)] gap-y-2" style={{ margin: 0 }}>
                {finding.evidence.rule && (
                  <>
                    <dt className="c3">Rule</dt>
                    <dd className="t-mono-s" style={{ margin: 0, wordBreak: "break-word" }}>
                      {finding.evidence.rule}
                    </dd>
                  </>
                )}
                {finding.evidence.advisories.length > 0 && (
                  <>
                    <dt className="c3">{finding.evidence.advisories.length === 1 ? "Advisory" : "Advisories"}</dt>
                    <dd className="flex flex-col gap-1" style={{ margin: 0 }}>
                      {finding.evidence.advisories.map((id) => (
                        <a key={id} href={`https://osv.dev/vulnerability/${encodeURIComponent(id)}`} target="_blank" rel="noreferrer" className="t-mono-s inline-flex items-center gap-1.5" style={{ color: "var(--text)" }}>
                          {id}
                          <ExternalLink {...icon14} />
                        </a>
                      ))}
                    </dd>
                  </>
                )}
                {doc && (
                  <>
                    <dt className="c3">Docs</dt>
                    <dd style={{ margin: 0 }}>
                      {docUrl ? (
                        <a href={docUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5" style={{ color: "var(--text)" }}>
                          {doc.title}
                          <ExternalLink {...icon14} />
                        </a>
                      ) : (
                        <span>{doc.title}</span>
                      )}
                      <span className="c3 block">
                        Read <LocalTime iso={finding.createdAt} style="sentence" />
                      </span>
                    </dd>
                  </>
                )}
              </dl>
            )}
          </section>

          {finding.actionKind === "fix" ? (
            <section className="panel flex flex-col gap-4" style={{ padding: "22px 24px", borderColor: "var(--line-strong)" }}>
              <h2 className="t-h3">A code change fixes this</h2>
              <p className="t-body c2">Your coding agent can make it: it reads this finding with birdsi_finding. birdsI writes no code. When the change is in, map again and the finding closes by itself.</p>
              {followUp.length > 0 && (
                <div className="flex flex-col gap-1.5" style={{ padding: "14px 16px", borderRadius: "var(--r-md)", background: "var(--raised)" }}>
                  <span className="t-label">{followUp.length === 1 ? "One step stays with you" : `${followUp.length === 2 ? "Two" : followUp.length === 3 ? "Three" : followUp.length} steps stay with you`}</span>
                  {followUp.map((s, i) => (
                    <span key={i} className="t-small c2">
                      {i + 1}. {s}
                    </span>
                  ))}
                </div>
              )}
              <div className={`${ACTION_BAR} min-[901px]:mt-1`}>
                <DismissControl findingId={finding.id} repoId={repo.id} dismissed={dismissed} />
                {!dismissed && <CheckAgainButton repoId={repo.id} />}
              </div>
            </section>
          ) : (
            <section className="panel flex flex-col gap-4" style={{ padding: "22px 24px", borderColor: "var(--line-strong)" }}>
              <h2 className="t-h3">Needs you outside the code</h2>
              {finding.steps.length > 0 && <StepsProgress findingId={finding.id} total={finding.steps.length} />}
              <div className={`${ACTION_BAR} min-[901px]:mt-1 min-[901px]:border-t min-[901px]:border-[var(--line)] min-[901px]:pt-4`}>
                <DismissControl findingId={finding.id} repoId={repo.id} dismissed={dismissed} />
                {!dismissed && <CheckAgainButton repoId={repo.id} />}
              </div>
            </section>
          )}

          <p className="t-small c3" style={{ padding: "0 4px" }}>
            Found in the {scanName(scan.kind).toLowerCase()} <LocalTime iso={scan.finishedAt ?? scan.createdAt} style="sentence" />. Check again maps the code again to confirm the fix, in about a minute.
          </p>
        </aside>
      </main>
    </>
  );
}
