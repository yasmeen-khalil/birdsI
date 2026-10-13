import Link from "next/link";
import { Check, ChevronLeft, ChevronRight, ExternalLink, Github, X } from "lucide-react";
import type { Finding, Fix, Scan } from "@birdsi/shared";
import { ActionKind } from "./ActionKind";
import { CodeExcerpt, DiffView } from "./CodeExcerpt";
import { ConfidencePill } from "./Confidence";
import { CheckAgainButton, DismissControl, StepsChecklist, StepsProgress } from "./FindingActions";
import { FixFlowPanel } from "./FixFlowPanel";
import { Frame } from "./Frame";
import { LocalTime } from "./LocalTime";
import { SeverityMeter } from "./Severity";
import { CONFIDENCE_MEANING, KIND_DURATION, KIND_LOWER, fixWasRun, locationText, plural, safeUrl } from "./format";
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
  fix,
  scan,
  mode,
  repo,
  position,
  backHref,
}: {
  finding: Finding;
  fix: Fix | null;
  scan: Scan;
  mode: "app" | "demo";
  repo: { id: string; fullName: string; defaultBranch: string } | null;
  position: FindingPosition;
  backHref: string;
}) {
  const doc = finding.evidence.doc;
  const docUrl = safeUrl(doc?.url);
  const loc = finding.location;
  const dismissed = finding.status === "dismissed";
  const checkKind = scan.kind === "audit" ? "deep" : scan.kind;
  const followUp = finding.fixPlan?.followUp ?? [];
  const patchReady = fix && fix.patch && (fix.status === "tested" || fix.status === "pr_open");

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
                  {finding.actionKind === "steps" && mode === "app" ? "Why it matters" : "Why it matters now"}
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
                <h2 className="t-h3">{patchReady ? "The change" : "The change birdsI will make"}</h2>
                {finding.fixPlan && finding.fixPlan.paths.length > 0 && (
                  <span className="t-small c3">
                    {plural(finding.fixPlan.paths.length, "file")}
                    {patchReady && fixWasRun(fix) ? ", tested in a sandbox" : ""}
                  </span>
                )}
              </div>
              {patchReady && fix?.patch ? (
                <DiffView patch={fix.patch} />
              ) : finding.fixPlan ? (
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
                  <p className="t-small c3">The exact change is written when you open the pull request, and tested first when sandbox testing is set up. You see the diff before you merge.</p>
                </>
              ) : (
                <p className="t-body c2">The change is written when you open the pull request, and tested first when sandbox testing is set up.</p>
              )}
            </section>
          )}

          {finding.actionKind === "steps" && (
            <section className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-baseline justify-between gap-3" style={{ paddingBottom: 10 }}>
                <h2 className="t-h2">What to do</h2>
                {finding.steps.length > 0 && <span className="t-small c3">{plural(finding.steps.length, "step")}</span>}
              </div>
              {finding.steps.length > 0 ? <StepsChecklist findingId={finding.id} steps={finding.steps} /> : <p className="t-body c2">birdsI has no steps for this one yet. Ask birdsI about it in chat and it walks you through the change.</p>}
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

          {mode === "demo" ? (
            <section className="panel flex flex-col gap-4" style={{ padding: "22px 24px", borderColor: "var(--line-strong)" }}>
              <h2 className="t-h3">{finding.actionKind === "fix" ? "birdsI can fix this" : "You need to do this"}</h2>
              <p className="t-body c2">
                {finding.actionKind === "fix"
                  ? "On your own repository, birdsI writes this change and opens a pull request you approve, tested on a separate copy first when sandbox testing is set up. The sample is read-only, so nothing here changes."
                  : "On your own repository, you get these steps with tick boxes and a Check again button that confirms the fix. The sample is read-only."}
              </p>
              <div className={ACTION_BAR}>
                <span />
                <Link className="btn btn-primary" href="/sign-in">
                  <Github {...icon} />
                  Sign in
                </Link>
              </div>
            </section>
          ) : finding.actionKind === "fix" ? (
            <section className="panel flex flex-col gap-4" style={{ padding: "22px 24px", borderColor: "var(--line-strong)" }}>
              <h2 className="t-h3">birdsI can fix this</h2>
              {finding.fixPlan?.summary && <p className="t-body c2">{finding.fixPlan.summary}</p>}
              <ul className="t-small flex flex-col gap-2.5" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                <li className="flex gap-2.5">
                  <Check {...icon} className="i c2" />
                  <span className="c2">Tested on a separate copy of your code first when sandbox testing is set up. Otherwise the pull request says so.</span>
                </li>
                <li className="flex gap-2.5">
                  <Check {...icon} className="i c2" />
                  <span className="c2">You review and merge it on GitHub. birdsI never merges.</span>
                </li>
              </ul>
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
                {repo && <DismissControl findingId={finding.id} repoId={repo.id} dismissed={dismissed} />}
                {repo && !dismissed && <FixFlowPanel findingId={finding.id} findingTitle={finding.title} fullName={repo.fullName} branch={scan.branch ?? repo.defaultBranch} plan={finding.fixPlan} initialFix={fix} nextHref={position.nextHref} />}
              </div>
            </section>
          ) : (
            <section className="panel flex flex-col gap-4" style={{ padding: "22px 24px", borderColor: "var(--line-strong)" }}>
              <h2 className="t-h3">You need to do this</h2>
              {finding.steps.length > 0 && <StepsProgress findingId={finding.id} total={finding.steps.length} />}
              <div className={`${ACTION_BAR} min-[901px]:mt-1 min-[901px]:border-t min-[901px]:border-[var(--line)] min-[901px]:pt-4`}>
                {repo && <DismissControl findingId={finding.id} repoId={repo.id} dismissed={dismissed} />}
                {repo && !dismissed && <CheckAgainButton repoId={repo.id} kind={checkKind} />}
              </div>
            </section>
          )}

          <p className="t-small c3" style={{ padding: "0 4px" }}>
            Found in the {mode === "demo" ? "sample scan" : KIND_LOWER[scan.kind]} <LocalTime iso={scan.finishedAt ?? scan.createdAt} style="sentence" />.
            {mode === "app" && finding.actionKind === "steps" && ` Check again runs a ${KIND_LOWER[checkKind]} to confirm the fix. ${KIND_DURATION[checkKind]}.`}
          </p>
        </aside>
      </main>
    </>
  );
}
