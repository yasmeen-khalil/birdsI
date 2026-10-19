"use client";

import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import { Check, X } from "lucide-react";
import { scannerNote, type ScanEventRecord, type ScanStatus } from "@birdsi/shared";
import { stopScanAction } from "@/lib/actions";
import { Arc } from "../Arc";
import { ConfidencePill } from "../Confidence";
import { ScanAgainButton } from "../ScanActions";
import { SeverityMeter } from "../Severity";
import { aboutTime, clock, longDuration, plural, shortDuration } from "../format";
import { icon } from "../icon";
import { stepDetail, type StepView } from "./model";
import { useElapsed, useScanEvents } from "./useScanEvents";

export interface LiveScanProps {
  scanId: string;
  repoId: string;
  appName: string;
  initialStatus: ScanStatus;
  initialEvents: ScanEventRecord[];
  initialCursor: number;
  stepLabels: Record<string, string>;
  heading: string;
  intro: string;
  expectedSeconds: number;
  scanError?: string | null;
  leaveNote: string;
}

function StepIcon({ state }: { state: StepView["state"] }) {
  if (state === "done") return <Check {...icon} className="i c2" />;
  if (state === "halted") return <X {...icon} style={{ color: "var(--critical)" }} />;
  return <Arc idle={state === "waiting"} />;
}

function StepRow({ s, now }: { s: StepView; now: number }) {
  const running = s.state === "running";
  const time = s.state === "done" && s.durationMs !== undefined ? shortDuration(s.durationMs).replace(" s", "s").replace(" min", "m") : running && s.startedAt ? clock(Math.max(0, (now - new Date(s.startedAt).getTime()) / 1000)) : "";
  return (
    <li className="grid grid-cols-[28px_minmax(0,1fr)_auto_44px] items-center" style={{ padding: "12px 0", borderBottom: "1px solid var(--line)" }}>
      <StepIcon state={s.state} />
      <span className={`t-body min-w-0${s.state === "waiting" ? " c3" : ""}`} style={running ? { fontWeight: 600 } : undefined}>
        {s.label}
      </span>
      <span className={`t-small ${running ? "ca" : s.state === "waiting" ? "c3" : "c2"}`} style={{ fontWeight: running ? 600 : undefined, ...(s.state === "halted" ? { color: "var(--critical)" } : {}) }}>
        {stepDetail(s)}
      </span>
      <span className="t-small c3 text-right">{time}</span>
    </li>
  );
}

function StopButton({ scanId, label }: { scanId: string; label: string }) {
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
            const result = await stopScanAction(scanId);
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

/** A map of the code as it runs: the steps on the left, the services and findings on the right as they arrive. */
export function LiveScan(props: LiveScanProps) {
  const { scanId, repoId, stepLabels, expectedSeconds } = props;
  const { view, status, connectionLost, workerSeenAt } = useScanEvents({ scanId, initialEvents: props.initialEvents, initialCursor: props.initialCursor, initialStatus: props.initialStatus, stepLabels });
  const scanner = scannerNote(workerSeenAt);
  const running = status === "running" || status === "queued";
  const elapsed = useElapsed(view.startedAt, running && view.startedAt !== null);
  const now = view.startedAt ? new Date(view.startedAt).getTime() + elapsed * 1000 : 0;
  const queued = status === "queued" || (status === "running" && view.steps.length === 0);
  const failedMessage = view.failed ?? (status === "failed" ? (props.scanError ?? "The map could not finish.") : null);
  const stopped = view.stopped || status === "stopped";
  const done = status === "done";
  const haltedIndex = view.steps.findIndex((s) => s.state === "halted");
  const stepNumber = haltedIndex >= 0 ? haltedIndex + 1 : view.runningIndex >= 0 ? view.runningIndex + 1 : null;
  const seconds = view.finished ? view.finished.durationMs / 1000 : elapsed;

  let header: ReactNode;
  if (failedMessage) {
    header = (
      <>
        <h1 className="t-h1">{stepNumber ? `The map stopped at step ${stepNumber}` : "The map did not finish"}</h1>
        <p className="t-body c2" style={{ marginTop: 14, maxWidth: 460 }}>
          {failedMessage}
          {view.findings.length > 0 ? ` The ${plural(view.findings.length, "finding")} from earlier steps ${view.findings.length === 1 ? "is" : "are"} shown here.` : ""} Try again in a minute.
        </p>
        <p className="t-mono-s c3" style={{ marginTop: 12 }}>
          Reference: map {scanId.slice(0, 6)}
        </p>
      </>
    );
  } else if (stopped) {
    header = (
      <>
        <h1 className="t-h1">The map was stopped</h1>
        <p className="t-body c2" style={{ marginTop: 14, maxWidth: 460 }}>
          {stepNumber ? `It stopped at step ${stepNumber}. ` : ""}
          {view.findings.length > 0 ? `${plural(view.findings.length, "finding")} from the finished steps ${view.findings.length === 1 ? "is" : "are"} kept.` : "Nothing was found before it stopped."}
        </p>
      </>
    );
  } else if (done) {
    header = (
      <>
        <h1 className="t-h1">{`${props.appName} is mapped`}</h1>
        <p className="t-body c2" style={{ marginTop: 14 }}>
          Finished{view.finished ? ` in ${longDuration(view.finished.durationMs)}` : ""}. Loading the overview.
        </p>
      </>
    );
  } else if (queued) {
    header = (
      <>
        <h1 className="t-h1">Your map is next</h1>
        <p className="t-body c2" style={{ marginTop: 14, maxWidth: 460 }}>
          {props.intro} {scanner ?? `It starts as soon as the worker is free, then runs for about ${aboutTime(expectedSeconds)}.`}
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
          {stopped && view.findings.length > 0 && (
            <Link className="btn btn-secondary btn-sm" href={`/app/${repoId}/findings?scan=${scanId}`}>
              See {plural(view.findings.length, "finding")}
            </Link>
          )}
          <ScanAgainButton repoId={repoId} />
        </div>
      );
    }
    if (done) return null;
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StopButton scanId={scanId} label={queued ? "Cancel" : "Stop"} />
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
            <div className="bar" style={{ marginTop: 14 }} role="progressbar" aria-label="Map progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(view.progress * 100)}>
              <i style={{ width: `${Math.round(view.progress * 100)}%`, ...(failedMessage || stopped ? { background: "var(--text-3)" } : {}) }} />
            </div>
            <ol className="flex flex-col" style={{ listStyle: "none", margin: "28px 0 0", padding: 0 }}>
              {view.steps.map((s) => (
                <StepRow key={s.step} s={s} now={now} />
              ))}
            </ol>
          </>
        )}
        {queued && (
          <div className="flex items-center gap-3" style={{ marginTop: 32 }}>
            <Arc />
            <span className="t-small c2">Waiting for the worker</span>
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
            The connection to birdsI dropped. The map keeps going, and this page reconnects every few seconds.
          </p>
        )}
        <div style={{ marginTop: "auto", paddingTop: 32 }}>{actions}</div>
      </section>

      <section className="flex min-w-0 flex-col gap-10 min-[901px]:col-span-6 min-[901px]:col-start-7">
        <div className="flex flex-col">
          <div className="flex flex-wrap items-baseline justify-between gap-2" style={{ paddingBottom: 8 }}>
            <h2 className="t-h3">Services</h2>
            <span className="t-small c3">{view.vendors.length === 0 ? (running ? "They appear once the code is listed." : "None found.") : plural(view.vendors.length, "service")}</span>
          </div>
          {view.vendors.map((v, i) => (
            <div key={v.slug} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4" style={{ padding: "10px 0", borderTop: "1px solid var(--line)", ...(i === view.vendors.length - 1 ? { borderBottom: "1px solid var(--line)" } : {}) }}>
              <span className="t-body min-w-0 truncate">{v.name}</span>
              <span className="t-small c3">found by {v.detectedBy.join(", ")}</span>
            </div>
          ))}
        </div>
        <div className="flex flex-col">
          <div className="flex flex-wrap items-baseline justify-between gap-2" style={{ paddingBottom: 8 }}>
            <h2 className="t-h3">{running ? "Found so far" : "Found"}</h2>
            <span className="t-small c3">{view.findings.length === 0 ? (running ? "Nothing yet. Findings appear as each check finishes." : "No findings from the steps that ran.") : plural(view.findings.length, "finding")}</span>
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
