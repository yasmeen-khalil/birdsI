"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { Check, CircleAlert, ExternalLink, GitPullRequest, X } from "lucide-react";
import type { Fix, FixPlan } from "@birdsi/shared";
import { startFixAction } from "@/lib/actions";
import { Arc, ButtonArc } from "./Arc";
import { DiffView } from "./CodeExcerpt";
import { Toast } from "./Toast";
import { clock, safeUrl } from "./format";
import { icon, icon14, icon20 } from "./icon";

const TESTED_GRACE_MS = 90_000;

function isWorking(fix: Fix | null, now: number): boolean {
  if (!fix) return false;
  if (fix.status === "proposed" || fix.status === "testing") return true;
  // "tested" is followed by "pr_open" when a pull request can be opened; wait briefly for it.
  return fix.status === "tested" && now - new Date(fix.updatedAt).getTime() < TESTED_GRACE_MS;
}

function Sheet({ label, onClose, header, footer, children }: { label: string; onClose: () => void; header: ReactNode; footer: ReactNode; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={label}>
      <div className="absolute inset-0" style={{ background: "var(--scrim)" }} onClick={onClose} />
      <section className="sheet slide-in-right absolute top-0 right-0 bottom-0 flex flex-col" style={{ width: "min(452px, 100vw)", borderLeft: "1px solid var(--line-strong)" }}>
        <div className="flex items-center justify-between gap-3" style={{ padding: "12px 12px 12px 22px", borderBottom: "1px solid var(--line)", minHeight: 60 }}>
          {header}
          <button type="button" className="btn btn-quiet btn-sm" aria-label="Close" onClick={onClose} autoFocus style={{ width: 44, height: 44, padding: 0 }}>
            <X {...icon20} />
          </button>
        </div>
        <div className="flex flex-grow flex-col gap-4 overflow-y-auto" style={{ padding: 22 }}>
          {children}
        </div>
        <div className="flex items-center justify-between gap-2.5" style={{ padding: "16px 22px calc(16px + env(safe-area-inset-bottom, 0px))", borderTop: "1px solid var(--line)" }}>
          {footer}
        </div>
      </section>
    </div>
  );
}

function StepLine({ state, label, last = false }: { state: "done" | "running" | "waiting"; label: string; last?: boolean }) {
  return (
    <li className="grid grid-cols-[24px_minmax(0,1fr)]" style={{ padding: "9px 0", ...(last ? {} : { borderBottom: "1px solid var(--line)" }) }}>
      {state === "done" ? <Check {...icon14} className="i c2" style={{ marginTop: 3 }} /> : <span style={{ marginTop: 3 }}><Arc size={14} idle={state === "waiting"} /></span>}
      <span className={state === "waiting" ? "c3" : undefined} style={state === "running" ? { fontWeight: 600 } : undefined}>
        {label}
      </span>
    </li>
  );
}

/**
 * "Open a pull request" and its side panel: confirm, testing in the sandbox,
 * the pull request is open, or it failed with the reason.
 */
export function FixFlowPanel({
  findingId,
  findingTitle,
  fullName,
  branch,
  plan,
  initialFix,
  nextHref,
}: {
  findingId: string;
  findingTitle: string;
  fullName: string;
  branch: string;
  plan: FixPlan | null;
  initialFix: Fix | null;
  nextHref: string | null;
}) {
  const router = useRouter();
  const [fix, setFix] = useState<Fix | null>(initialFix);
  const [open, setOpen] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ tone: "ok" | "error"; text: string; href?: string } | null>(null);
  const [pending, start] = useTransition();
  const [now, setNow] = useState(() => Date.now());
  const fixRef = useRef(fix);
  useEffect(() => {
    fixRef.current = fix;
  }, [fix]);

  const working = isWorking(fix, now);
  const fixId = fix?.id ?? null;

  useEffect(() => {
    if (!fixId || !working) return;
    let stopped = false;
    let timer: number | undefined;
    const tick = async () => {
      try {
        const res = await fetch(`/api/v1/fixes/${encodeURIComponent(fixId)}`, { cache: "no-store" });
        if (res.ok) {
          const body = (await res.json()) as { fix: Fix };
          if (stopped) return;
          const before = fixRef.current?.status;
          setFix(body.fix);
          if (body.fix.status === "pr_open" && before !== "pr_open") {
            setToast({ tone: "ok", text: `Pull request #${body.fix.prNumber ?? ""} is open`, ...(safeUrl(body.fix.prUrl) ? { href: safeUrl(body.fix.prUrl)! } : {}) });
            router.refresh();
          } else if (body.fix.status === "failed" && before !== "failed") {
            setToast({ tone: "error", text: "The fix did not pass its tests. No pull request was opened." });
          }
          if (!isWorking(body.fix, Date.now())) return;
        }
      } catch {
        // Keep polling; a dropped request is not a failed fix.
      }
      if (!stopped) timer = window.setTimeout(tick, 3000);
    };
    timer = window.setTimeout(tick, 3000);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [fixId, working, router]);

  useEffect(() => {
    if (!working) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [working]);

  const begin = () =>
    start(async () => {
      setError(null);
      const result = await startFixAction(findingId);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      const started: Fix = { id: result.data.fixId, findingId, status: "proposed", patch: null, testLog: null, prNumber: null, prUrl: null, error: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      setFix(started);
      setNow(Date.now());
      setShowLog(false);
    });

  const close = () => setOpen(false);
  const prUrl = safeUrl(fix?.prUrl);
  const branchName = `birdsi/fix-${findingId.slice(0, 8)}`;
  const files = plan?.paths ?? [];
  const followUp = plan?.followUp ?? [];

  // Trigger button, beside Dismiss in the action row.
  let trigger: ReactNode;
  if (fix?.status === "pr_open") {
    trigger = prUrl ? (
      <a className="btn btn-primary" href={prUrl} target="_blank" rel="noreferrer">
        Review pull request #{fix.prNumber}
        <ExternalLink {...icon} />
      </a>
    ) : (
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        Pull request #{fix.prNumber} is open
      </button>
    );
  } else if (working) {
    trigger = (
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        <ButtonArc />
        {fix?.status === "proposed" ? "Writing the fix" : "Testing"}
      </button>
    );
  } else if (fix?.status === "tested") {
    trigger = (
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        <Check {...icon} />
        See the tested change
      </button>
    );
  } else {
    trigger = (
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <GitPullRequest {...icon} />
        Open a pull request
      </button>
    );
  }

  let sheet: ReactNode = null;
  if (open) {
    if (!fix || (fix.status === "failed" && pending)) {
      sheet = (
        <Sheet
          label="Open a pull request"
          onClose={close}
          header={<h2 className="t-h3">Open a pull request</h2>}
          footer={
            <>
              <button type="button" className="btn btn-muted" onClick={close} style={{ minHeight: 44 }}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary btn-sm" onClick={begin} disabled={pending}>
                {pending && <ButtonArc />}
                Test and open
              </button>
            </>
          }
        >
          <p className="t-small c2">
            On {fullName}, into {branch}
          </p>
          <div className="field">
            <label htmlFor="fix-branch">Branch</label>
            <input id="fix-branch" className="input mono" readOnly value={branchName} style={{ height: 38 }} />
          </div>
          <div className="field">
            <label htmlFor="fix-title">Title</label>
            <input id="fix-title" className="input" readOnly value={`Fix: ${findingTitle}`.slice(0, 120)} style={{ height: 38, fontSize: 14 }} />
          </div>
          {plan?.summary && <p className="t-small c2">{plan.summary}</p>}
          {files.length > 0 && (
            <div className="t-small flex flex-col gap-1.5">
              <span className="t-label">{files.length === 1 ? "1 file" : `${files.length} files`}</span>
              {files.map((p) => (
                <span key={p} className="path">
                  {p}
                </span>
              ))}
            </div>
          )}
          <p className="t-small c3">birdsI writes the change, then runs your project’s own build and tests on a separate copy (a sandbox). The pull request opens only if they pass. birdsI never merges it.</p>
          {error && (
            <p className="t-small" role="alert" style={{ color: "var(--critical)" }}>
              {error}
            </p>
          )}
        </Sheet>
      );
    } else if (working) {
      const elapsed = Math.max(0, (now - new Date(fix.createdAt).getTime()) / 1000);
      const stage = fix.status === "proposed" ? 0 : fix.status === "testing" ? 1 : 2;
      sheet = (
        <Sheet
          label="Testing the fix"
          onClose={close}
          header={<h2 className="t-h3">{stage === 0 ? "Writing the fix" : stage === 1 ? "Testing the fix" : "Opening the pull request"}</h2>}
          footer={
            <>
              <span />
              <span className="t-small c3">You can close this. birdsI keeps going.</span>
            </>
          }
        >
          <div className="flex items-baseline gap-2.5">
            <span style={{ fontFamily: "var(--serif)", fontSize: 32, fontWeight: 300, lineHeight: 1 }}>{clock(elapsed)}</span>
            <span className="t-small c3">of about 3 min</span>
          </div>
          <div className="bar" role="progressbar" aria-label="Fix progress" aria-valuemin={0} aria-valuemax={3} aria-valuenow={stage}>
            <i style={{ width: `${Math.round(((stage + 0.5) / 3) * 100)}%` }} />
          </div>
          <ol className="t-small flex flex-col" style={{ listStyle: "none", margin: 0, padding: 0 }} aria-live="polite">
            <StepLine state={stage > 0 ? "done" : "running"} label={files.length > 0 ? `Write the change to ${files.length === 1 ? "1 file" : `${files.length} files`}` : "Write the change"} />
            <StepLine state={stage > 1 ? "done" : stage === 1 ? "running" : "waiting"} label="Test it on a separate copy: install, build, run tests" />
            <StepLine state={stage === 2 ? "running" : "waiting"} label="Open the pull request" last />
          </ol>
          {fix.testLog && (
            <div className="code" style={{ fontSize: 12, lineHeight: 1.6 }}>
              <div className="bd" style={{ padding: "10px 14px", whiteSpace: "pre-wrap", color: "var(--text-2)", maxHeight: 240, overflowY: "auto" }}>
                {fix.testLog}
              </div>
            </div>
          )}
        </Sheet>
      );
    } else if (fix.status === "pr_open") {
      sheet = (
        <Sheet
          label="Pull request opened"
          onClose={close}
          header={
            <span className="t-small inline-flex items-center gap-2" style={{ color: "var(--ok)", fontWeight: 600 }}>
              <Check {...icon} />
              Opened
            </span>
          }
          footer={
            <>
              {nextHref ? (
                <a className="btn btn-secondary btn-sm" href={nextHref}>
                  Next finding
                </a>
              ) : (
                <span />
              )}
              {prUrl && (
                <a className="btn btn-primary btn-sm" href={prUrl} target="_blank" rel="noreferrer">
                  Review on GitHub
                  <ExternalLink {...icon} />
                </a>
              )}
            </>
          }
        >
          <h2 className="t-h2">Pull request #{fix.prNumber} is open</h2>
          <p className="t-small c2">It passed its tests and is waiting for you on GitHub. birdsI never merges.</p>
          {prUrl && (
            <a className="path" href={prUrl} target="_blank" rel="noreferrer" style={{ color: "var(--text)", whiteSpace: "normal", wordBreak: "break-all" }}>
              {prUrl.replace(/^https?:\/\//, "")}
            </a>
          )}
          <div className="flex flex-col gap-2" style={{ padding: "14px 16px", background: "var(--raised)", borderRadius: "var(--r-md)" }}>
            <span className="t-label">Next, in this order</span>
            {followUp.concat("Merge the pull request. The next scan closes this finding.").map((s, i) => (
              <span key={i} className="t-small c2">
                {i + 1}. {s}
              </span>
            ))}
          </div>
        </Sheet>
      );
    } else if (fix.status === "tested") {
      sheet = (
        <Sheet
          label="The change is tested"
          onClose={close}
          header={
            <span className="t-small inline-flex items-center gap-2" style={{ color: "var(--ok)", fontWeight: 600 }}>
              <Check {...icon} />
              Tested
            </span>
          }
          footer={
            <>
              <button type="button" className="btn btn-muted" onClick={close} style={{ minHeight: 44 }}>
                Close
              </button>
              <span />
            </>
          }
        >
          <h2 className="t-h2">The change is ready, but no pull request was opened</h2>
          <p className="t-small c2">birdsI does not have permission to open pull requests on {fullName}. Reinstall the GitHub App from Connect to allow it, or apply the change below yourself.</p>
          {fix.testLog && <p className="t-small c3">{fix.testLog.split("\n").slice(-1)[0]}</p>}
          {fix.patch && <DiffView patch={fix.patch} />}
        </Sheet>
      );
    } else {
      sheet = (
        <Sheet
          label="The fix did not pass"
          onClose={close}
          header={
            <span className="t-small inline-flex items-center gap-2" style={{ color: "var(--critical)", fontWeight: 600 }}>
              <CircleAlert {...icon} />
              Not opened
            </span>
          }
          footer={
            <>
              <button type="button" className="btn btn-muted" onClick={close} style={{ minHeight: 44 }}>
                Cancel
              </button>
              <span className="inline-flex gap-2">
                {fix.testLog && (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowLog((s) => !s)} aria-expanded={showLog}>
                    {showLog ? "Hide output" : "Full output"}
                  </button>
                )}
                <button type="button" className="btn btn-primary btn-sm" onClick={begin} disabled={pending}>
                  {pending && <ButtonArc />}
                  Try again
                </button>
              </span>
            </>
          }
        >
          <h2 className="t-h2">{fix.testLog ? "The fix did not pass your tests" : "birdsI could not make this change"}</h2>
          <p className="t-small c2">{fix.error ?? "birdsI stopped before the change was finished."} Nothing in your repository changed.</p>
          {fix.testLog && (
            <div className="code" style={{ fontSize: 12, lineHeight: 1.6 }}>
              <div className="bd" style={{ padding: "10px 14px", whiteSpace: "pre-wrap", color: "var(--text-2)", maxHeight: showLog ? 480 : 132, overflowY: "auto" }}>
                {showLog ? fix.testLog : fix.testLog.split("\n").slice(-6).join("\n")}
              </div>
            </div>
          )}
          {error && (
            <p className="t-small" role="alert" style={{ color: "var(--critical)" }}>
              {error}
            </p>
          )}
        </Sheet>
      );
    }
  }

  return (
    <>
      <span className="inline-flex flex-col items-end gap-1.5">
        {trigger}
        {fix?.status === "failed" && !open && (
          <button type="button" className="btn btn-muted t-small" onClick={() => setOpen(true)} style={{ fontSize: 13 }}>
            The last attempt did not pass. See why
          </button>
        )}
      </span>
      {sheet}
      {toast && (
        <Toast
          tone={toast.tone}
          onClose={() => setToast(null)}
          action={
            toast.href ? (
              <a className="btn btn-quiet btn-sm" href={toast.href} target="_blank" rel="noreferrer">
                View
              </a>
            ) : undefined
          }
        >
          {toast.text}
        </Toast>
      )}
    </>
  );
}
