"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ScanEventRecord, ScanEventsResponse, ScanStatus } from "@birdsi/shared";
import { deriveScanView, isTerminal, type ScanView } from "./model";

/**
 * Polls the scan's event log every two seconds until it finishes, fails or
 * stops, then refreshes the page so the server can show the result.
 */
export function useScanEvents({
  scanId,
  initialEvents,
  initialCursor,
  initialStatus,
  stepLabels,
}: {
  scanId: string;
  initialEvents: ScanEventRecord[];
  initialCursor: number;
  initialStatus: ScanStatus;
  stepLabels: Record<string, string>;
}): { view: ScanView; status: ScanStatus; events: ScanEventRecord[]; connectionLost: boolean } {
  const router = useRouter();
  const [events, setEvents] = useState(initialEvents);
  const [status, setStatus] = useState<ScanStatus>(initialStatus);
  const [failures, setFailures] = useState(0);
  const cursor = useRef(initialCursor);

  useEffect(() => {
    if (isTerminal(initialStatus)) return;
    let stopped = false;
    let timer: number | undefined;
    const tick = async () => {
      try {
        const res = await fetch(`/api/v1/scans/${encodeURIComponent(scanId)}/events?after=${cursor.current}`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as ScanEventsResponse;
        if (stopped) return;
        if (body.events.length > 0) {
          cursor.current = body.cursor;
          setEvents((prev) => prev.concat(body.events.filter((e) => e.seq > (prev[prev.length - 1]?.seq ?? 0))));
        }
        setFailures(0);
        setStatus(body.status);
        if (isTerminal(body.status)) {
          router.refresh();
          return;
        }
      } catch {
        if (!stopped) setFailures((n) => n + 1);
      }
      if (!stopped) timer = window.setTimeout(tick, 2000);
    };
    timer = window.setTimeout(tick, 2000);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [scanId, initialStatus, router]);

  const view = useMemo(() => deriveScanView(events, stepLabels), [events, stepLabels]);
  return { view, status, events, connectionLost: failures >= 3 };
}

/** Seconds since a time, ticking once a second while `running`. */
export function useElapsed(since: string | null, running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [running]);
  if (!since) return 0;
  return Math.max(0, (now - new Date(since).getTime()) / 1000);
}
