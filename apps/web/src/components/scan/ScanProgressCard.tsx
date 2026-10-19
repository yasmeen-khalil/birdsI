"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { ScanEventRecord, ScanStatus } from "@birdsi/shared";
import { stopScanAction } from "@/lib/actions";
import { aboutTime, clock, MAP_SECONDS } from "../format";
import { useElapsed, useScanEvents } from "./useScanEvents";
import { scannerNote } from "@birdsi/shared";

/** The overview's compact view of a running map, with a link to the full live view. */
export function ScanProgressCard({
  scanId,
  repoId,
  initialStatus,
  initialEvents,
  initialCursor,
  stepLabels,
  hasEarlierResults,
}: {
  scanId: string;
  repoId: string;
  initialStatus: ScanStatus;
  initialEvents: ScanEventRecord[];
  initialCursor: number;
  stepLabels: Record<string, string>;
  hasEarlierResults: boolean;
}) {
  const { view, status, workerSeenAt } = useScanEvents({ scanId, initialEvents, initialCursor, initialStatus, stepLabels });
  const scanner = scannerNote(workerSeenAt);
  const running = status === "running" || status === "queued";
  const elapsed = useElapsed(view.startedAt, running && view.startedAt !== null);
  const [pending, start] = useTransition();
  const [stopRequested, setStopRequested] = useState(false);
  const step = view.steps[view.runningIndex];
  const queued = status === "queued" || view.steps.length === 0;
  const href = `/app/${repoId}/scans/${scanId}`;

  return (
    <section className="panel flex flex-col gap-3.5" style={{ padding: "22px 24px" }} aria-live="polite" aria-labelledby="scan-running-title">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="scan-running-title" className="t-h2" style={{ fontSize: 23 }}>
          {queued ? "The map is next" : "Mapping the code"}
        </h2>
        {!queued && (
          <span className="t-small ca" style={{ fontWeight: 600 }}>
            {clock(elapsed)} of about {aboutTime(MAP_SECONDS)}
          </span>
        )}
      </div>
      <div className="bar" role="progressbar" aria-label="Map progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(view.progress * 100)}>
        <i style={{ width: `${Math.round(view.progress * 100)}%` }} />
      </div>
      <p className="t-small c2" id="scan-running-note">
        {queued ? (
          (scanner ?? "Waiting for the worker. It starts in a moment.")
        ) : step ? (
          <>
            Step {view.runningIndex + 1} of {view.steps.length}, {step.label.charAt(0).toLowerCase() + step.label.slice(1)}.
          </>
        ) : (
          "Finishing up."
        )}
      </p>
      {hasEarlierResults && <p className="t-small c3">The page shows the last finished map until this one is done.</p>}
      <div className="flex flex-wrap items-center justify-between gap-3" style={{ marginTop: 4 }}>
        <button
          type="button"
          className="btn btn-muted"
          style={{ minHeight: 44 }}
          disabled={pending || stopRequested}
          onClick={() =>
            start(async () => {
              const r = await stopScanAction(scanId);
              if (r.ok) setStopRequested(true);
            })
          }
        >
          {stopRequested ? "Stopping" : "Stop"}
        </button>
        <Link className="btn btn-secondary btn-sm" href={href}>
          Watch progress
        </Link>
      </div>
    </section>
  );
}
