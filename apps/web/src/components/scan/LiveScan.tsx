"use client";

import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import { Check, X } from "lucide-react";
import { AUDIT_AREAS, scannerNote, type ScanEventRecord, type ScanKind, type ScanStatus } from "@birdsi/shared";
import { stopDemoScanAction, stopScanAction } from "@/lib/actions";
import { Arc } from "../Arc";
import { BirdsEyeMap, hitsFromFindings, MapLegend } from "../BirdsEyeMap";
import { ConfidencePill } from "../Confidence";
import { DemoButton } from "../DemoButton";
import { Frame } from "../Frame";
import { ScanAgainButton } from "../ScanActions";
import { SeverityMeter } from "../Severity";
import { Skeleton } from "../Skeleton";
import { aboutTime, clock, KIND_LOWER, longDuration, plural, shortDuration } from "../format";
import { icon } from "../icon";
import { stepDetail, type ScanView, type StepView } from "./model";
import { useElapsed, useScanEvents } from "./useScanEvents";

export interface LiveScanProps {
  scanId: string;
  kind: ScanKind;
  initialStatus: ScanStatus;
  initialEvents: ScanEventRecord[];
  initialCursor: number;
  stepLabels: Record<string, string>;
  heading: string;
  intro: string;
  mapTitle: string;
  mode: "demo" | "app";
  repoId?: string;
  expectedSeconds: number;
  scanError?: string | null;
  leaveNote: string;
  /** Pre-launch audit: the launch areas, judged once every file is read. */
  areaTitles?: Record<string, string>;
}

function StepIcon({ state }: { state: StepView["state"] }) {
  if (state === "done") return <Check {...icon} className="i c2" />;
  if (state === "halted") return <X {...icon} style={{ color: "var(--critical)" }} />;
  return <Arc idle={state === "waiting"} />;
}

function StepRow({ s, reading, now }: { s: StepView; reading: ScanView["reading"]; now: number }) {
  const running = s.state === "running";
  const sub = running && reading && reading.step === s.step ? `Reading ${reading.path}` : null;
  const time = s.state === "done" && s.durationMs !== undefined ? shortDuration(s.durationMs).replace(" s", "s").replace(" min", "m") : running && s.startedAt ? clock(Math.max(0, (now - new Date(s.startedAt).getTime()) / 1000)) : "";
  return (
    <li className="grid grid-cols-[28px_minmax(0,1fr)_auto_44px] items-center" style={{ padding: running ? "14px 0" : "12px 0", borderBottom: "1px solid var(--line)", alignItems: running ? "start" : "center" }}>
      <span style={running ? { marginTop: 4 } : undefined}>
        <StepIcon state={s.state} />
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        <span className={`t-body${s.state === "waiting" ? " c3" : ""}`} style={running ? { fontWeight: 600 } : undefined}>
          {s.label}
        </span>
        {sub && <span className="t-small c2 truncate">{sub}</span>}
      </span>
      <span className={`t-small ${running ? "ca" : s.state === "waiting" ? "c3" : "c2"}`} style={{ fontWeight: running ? 600 : undefined, ...(s.state === "halted" ? { color: "var(--critical)" } : {}) }}>
        {stepDetail(s)}
      </span>
      <span className="t-small c3 text-right">{time}</span>
    </li>
  );
}

function StopButton({ scanId, mode, label }: { scanId: string; mode: "demo" | "app"; label: string }) {
  const [pending, start] = useTransition();
  const [requested, setRequested] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="flex flex-col items-start gap-1">
      <button
        type="button"
        className="btn btn-muted"
        disabled={pending || requested}
        style={{ minHeight: 44 }}
        onClick={() =>
          start(async () => {
            const result = mode === "demo" ? await stopDemoScanAction(scanId) : await stopScanAction(scanId);
            if (result.ok) setRequested(true);
            else setError(result.message);
          })
        }
      >
        {requested ? "Stopping" : label}
      </button>
      {error && (
        <span className="t-small" role="alert" style={{ color: "var(--critical)" }}>
          {error}
        </span>
      )}
    </span>
  );
}

export function LiveScan(props: LiveScanProps) {
  const { scanId, kind, mode, repoId, stepLabels, expectedSeconds } = props;
  const { view, status, connectionLost, workerSeenAt } = useScanEvents({ scanId, initialEvents: props.initialEvents, initialCursor: props.initialCursor, initialStatus: props.initialStatus, stepLabels });
  const scanner = scannerNote(workerSeenAt);
  const running = status === "running" || status === "queued";
  const elapsed = useElapsed(view.startedAt, running && view.startedAt !== null);
  const now = view.startedAt ? new Date(view.startedAt).getTime() + elapsed * 1000 : 0;
  const hits = hitsFromFindings(view.findings.map((f) => ({ severity: f.severity, location: f.location })));
  const queued = status === "queued" || (status === "running" && view.steps.length === 0);
  const failedMessage = view.failed ?? (status === "failed" ? (props.scanError ?? "The scan could not finish.") : null);
  const stopped = view.stopped || status === "stopped";
  const done = status === "done";
  const haltedIndex = view.steps.findIndex((s) => s.state === "halted");
  const stepNumber = haltedIndex >= 0 ? haltedIndex + 1 : view.runningIndex >= 0 ? view.runningIndex + 1 : null;
  const seconds = view.finished ? view.finished.durationMs / 1000 : elapsed;
  const name = props.mapTitle.replace(/ from above$/, "");

  let header: ReactNode;
  if (failedMessage) {
    header = (
      <>
        <h1 className="t-h1">{stepNumber ? `The ${mode === "demo" ? "sample scan" : KIND_LOWER[kind]} stopped at step ${stepNumber}` : `The ${mode === "demo" ? "sample scan" : KIND_LOWER[kind]} did not finish`}</h1>
        <p className="t-body c2" style={{ marginTop: 14, maxWidth: 460 }}>
          {failedMessage}
          {view.findings.length > 0 ? ` The ${plural(view.findings.length, "finding")} from earlier steps ${view.findings.length === 1 ? "is" : "are"} shown here.` : ""} Try again in a minute.
        </p>
        <p className="t-mono-s c3" style={{ marginTop: 12 }}>
          Reference: scan {scanId.slice(0, 6)}
        </p>
      </>
    );
  } else if (stopped) {
    header = (
      <>
        <h1 className="t-h1">{mode === "demo" ? "The sample scan was stopped" : `The ${KIND_LOWER[kind]} was stopped`}</h1>
        <p className="t-body c2" style={{ marginTop: 14, maxWidth: 460 }}>
          {stepNumber ? `It stopped at step ${stepNumber}. ` : ""}
          {view.findings.length > 0 ? `${plural(view.findings.length, "finding")} from the finished steps ${view.findings.length === 1 ? "is" : "are"} kept.` : "Nothing was found before it stopped."}
        </p>
      </>
    );
  } else if (done) {
    header = (
      <>
        <h1 className="t-h1">{`${plural(view.finished?.findings ?? view.findings.length, "finding")} in ${name}`}</h1>
        <p className="t-body c2" style={{ marginTop: 14 }}>
          Scan finished{view.finished ? ` in ${longDuration(view.finished.durationMs)}` : ""}. Loading the results.
        </p>
      </>
    );
  } else if (queued) {
    header = (
      <>
        <h1 className="t-h1">{mode === "demo" ? "Your sample scan is next" : `Your ${KIND_LOWER[kind]} is next`}</h1>
        <p className="t-body c2" style={{ marginTop: 14, maxWidth: 460 }}>
          {props.intro} {scanner ?? `It starts as soon as a scanner is free, then runs for about ${aboutTime(expectedSeconds)}.`}
        </p>
      </>
    );
  } else {
    header = (
      <>
        <h1 className="t-h1">{props.heading}</h1>
        <p className="t-body c2" style={{ marginTop: 14, maxWidth: 460 }}>
          {props.intro}
        </p>
      </>
    );
  }

  const actions = (() => {
    if (failedMessage || stopped) {
      return (
        <div className="flex flex-wrap items-center justify-end gap-2.5">
          {mode === "app" && repoId && stopped && view.findings.length > 0 && (
            <Link className="btn btn-secondary btn-sm" href={`/app/${repoId}/findings?scan=${scanId}`}>
              See {plural(view.findings.length, "finding")}
            </Link>
          )}
          {mode === "demo" ? <DemoButton label="Try again" className="btn btn-primary btn-sm" showIcon={false} /> : repoId ? <ScanAgainButton repoId={repoId} kind={kind} /> : null}
        </div>
      );
    }
    if (done) return null;
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StopButton scanId={scanId} mode={mode} label={queued ? "Cancel" : kind === "audit" ? "Stop audit" : "Stop scan"} />
        <span className="t-small c3">{props.leaveNote}</span>
      </div>
    );
  })();

  return (
    <div className="grid grid-cols-1 gap-y-12 min-[901px]:grid-cols-12 min-[901px]:gap-x-6">
      <section className="flex flex-col min-[901px]:col-span-5" aria-live="polite" aria-busy={running}>
        {header}
        {!queued && view.steps.length > 0 && (
          <>
            <div className="flex items-baseline gap-3" style={{ marginTop: 36 }}>
              <span style={{ fontFamily: "var(--serif)", fontSize: 44, fontWeight: 300, lineHeight: 1, letterSpacing: "-0.01em" }}>{clock(seconds)}</span>
              {running && <span className="t-body c3">of about {aboutTime(expectedSeconds)}</span>}
              {running && view.runningIndex >= 0 && (
                <span className="t-small ca" style={{ marginLeft: "auto", fontWeight: 600 }}>
                  Step {view.runningIndex + 1} of {view.steps.length}
                </span>
              )}
            </div>
            <div className="bar" style={{ marginTop: 14 }} role="progressbar" aria-label="Scan progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(view.progress * 100)}>
              <i style={{ width: `${Math.round(view.progress * 100)}%`, ...(failedMessage || stopped ? { background: "var(--text-3)" } : {}) }} />
            </div>
            <ol className="flex flex-col" style={{ listStyle: "none", margin: "28px 0 0", padding: 0 }}>
              {view.steps.map((s) => (
                <StepRow key={s.step} s={s} reading={view.reading} now={now} />
              ))}
            </ol>
          </>
        )}
        {queued && (
          <div className="flex flex-col gap-3" style={{ marginTop: 32 }}>
            <div className="flex items-center gap-3">
              <Arc />
              <span className="t-small c2">Waiting for a free scanner</span>
            </div>
          </div>
        )}
        {view.notes.length > 0 && (
          <ul className="t-small c3 flex flex-col gap-1.5" style={{ listStyle: "none", margin: "20px 0 0", padding: 0 }}>
            {view.notes.slice(-4).map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        )}
        {connectionLost && running && (
          <p className="t-small" role="status" style={{ marginTop: 16, color: "var(--high)" }}>
            The connection to birdsI dropped. The scan keeps going, and this page reconnects every few seconds.
          </p>
        )}
        <div style={{ marginTop: "auto", paddingTop: 32 }}>{actions}</div>
      </section>

      <section className="flex min-w-0 flex-col gap-7 min-[901px]:col-span-6 min-[901px]:col-start-7">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="t-h3">{props.mapTitle}</h2>
          {view.inventory && running ? <MapLegend /> : view.inventory ? <span className="t-small c3">{plural(view.inventory.filesSeen, "file")}</span> : null}
        </div>
        {view.inventory ? (
          <BirdsEyeMap folders={view.inventory.folders} hits={hits} mode={running ? "scan" : "rest"} lit={view.readPaths} current={view.reading?.path ?? null} label={`${name} seen from above, one square per file`} style={{ gap: "26px 34px", minHeight: 120 }} />
        ) : (
          <div className="flex flex-col gap-3" aria-hidden="true">
            <div className="flex flex-wrap gap-6">
              {[40, 24, 32, 18, 28].map((w, i) => (
                <div key={i} className="flex flex-col gap-2">
                  <Skeleton width={w * 2} height={9} />
                  <Skeleton width={w * 2.4} height={40} />
                </div>
              ))}
            </div>
            <span className="t-small c3">{queued ? "The map appears once birdsI has listed every file." : "Mapping every file"}</span>
          </div>
        )}

        {view.reading && running && (
          <Frame arm={18} bend={13} accent className="flex flex-col gap-3" style={{ padding: "20px 22px" }} aria-label="Reading now">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <span className="t-mono min-w-0 break-all" style={{ color: "var(--text)" }}>
                {view.reading.path}
              </span>
              {(() => {
                const step = view.steps.find((s) => s.step === view.reading?.step);
                return step?.total ? (
                  <span className="t-small c3">
                    file {Math.min(step.total, (step.done ?? 0) + 1)} of {step.total}
                  </span>
                ) : null;
              })()}
            </div>
            <div className="t-small grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-y-2">
              {view.reading.checks.map((c) => (
                <FragmentRow key={c} text={c} />
              ))}
            </div>
          </Frame>
        )}

        {props.areaTitles && (
          <div className="flex flex-col">
            <div className="flex items-baseline justify-between gap-3" style={{ paddingBottom: 8 }}>
              <h2 className="t-h3">The {AUDIT_AREAS.length} launch areas</h2>
              <span className="t-small c3">{view.areas.length > 0 ? `${view.areas.length} of ${AUDIT_AREAS.length} judged` : "Judged once every file is read"}</span>
            </div>
            {Object.entries(props.areaTitles).map(([area, title], i, all) => {
              const result = view.areas.find((a) => a.area === area);
              return (
                <div key={area} className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center" style={{ padding: "10px 0", borderTop: "1px solid var(--line)", ...(i === all.length - 1 ? { borderBottom: "1px solid var(--line)" } : {}) }}>
                  {result ? <Check {...icon} className="i c2" /> : <span style={{ width: 14, height: 14, border: "1.5px solid var(--line-strong)", borderRadius: 3 }} aria-hidden="true" />}
                  <span className={`t-small${result ? "" : " c3"}`}>{title}</span>
                  <span className="t-small" style={{ color: result?.verdict === "blocker" ? "var(--critical)" : result?.verdict === "attention" ? "var(--high)" : "var(--text-3)", fontWeight: result && result.verdict !== "pass" ? 600 : 400 }}>
                    {result ? (result.verdict === "blocker" ? "Blocks launch" : result.verdict === "attention" ? "Fix before launch" : "Cleared") : "waiting"}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex flex-col">
          <div className="flex flex-wrap items-baseline justify-between gap-2" style={{ paddingBottom: 8 }}>
            <h2 className="t-h3">{running ? "Found so far" : "Found"}</h2>
            <span className="t-small c3">{view.findings.length === 0 ? (running ? "Nothing yet. Findings appear as each check finishes." : "No findings from the steps that ran.") : `${plural(view.findings.length, "finding")}.${running ? " More may appear as the code is read." : ""}`}</span>
          </div>
          {view.findings.map((f, i) => (
            <div key={f.id} className="grid grid-cols-[96px_minmax(0,1fr)] items-center gap-x-5 gap-y-2 min-[901px]:grid-cols-[96px_minmax(0,1fr)_auto]" style={{ padding: "12px 0", borderTop: "1px solid var(--line)", ...(i === view.findings.length - 1 ? { borderBottom: "1px solid var(--line)" } : {}) }}>
              <SeverityMeter severity={f.severity} />
              <span className="t-body min-w-0">{f.title}</span>
              <span className="col-start-2 min-[901px]:col-start-auto">
                <ConfidencePill confidence={f.confidence} />
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function FragmentRow({ text }: { text: string }) {
  return (
    <>
      <svg viewBox="0 0 16 16" style={{ width: 14, height: 14 }} aria-hidden="true">
        <circle cx="8" cy="8" r="6" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="2.5 2.5" />
      </svg>
      <span style={{ color: "var(--text)" }}>Looking for {text}</span>
      <span className="ca" style={{ fontWeight: 600 }}>
        checking
      </span>
    </>
  );
}

